import { computed, shallowRef } from 'vue';
import type { NetworkId, SignedTransaction, TipConsensusReport } from '@kristatech/sdk';
import {
  DEFAULT_NETWORK_ENDPOINTS,
  UnlockedWalletSession,
  checkMultiServerConsensus,
  createHdWalletProfile,
  createWalletTransport,
  createWatchOnlyProfile,
  deriveWatchOnlyAddressList,
  restoreFromMnemonicProfile,
  restoreFromWifOrBip38Profile,
  revealWalletMnemonic,
  sanitizeEndpointsConfig,
  syncWalletState,
  unlockWalletProfile,
  verifySelectedInputsOnline,
  verifyTransactionSpv,
  type NetworkEndpointsConfig,
  type StoredWalletProfile,
  type WalletSyncSnapshot,
  type WalletTransportBundle
} from '~/utils/walletCore';
import {
  MAX_PIN_ATTEMPTS,
  MobileWalletStorageManager,
  shouldAutoLockOnResume
} from '~/utils/mobileVault';
import { parseIncomingMobileLink } from '~/utils/deepLink';
import {
  createCapacitorKeyValueStore,
  getPlatformName,
  hapticNotify,
  isNativePlatform
} from '~/utils/nativeBridge';

const AUTO_SYNC_POLL_MS = 15_000;
const AUTO_SYNC_DEBOUNCE_MS = 400;
const SUBSCRIPTION_RETRY_COOLDOWN_MS = 60_000;
const UNLOCK_BACKOFF_MS = [0, 0, 0, 2_000, 5_000, 15_000, 30_000, 60_000];

const unlockGuardByProfile = new Map<string, { failCount: number; blockedUntil: number }>();

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let autoSyncDebounce: ReturnType<typeof setTimeout> | null = null;
let visibilityListener: (() => void) | null = null;
let activeTransport: WalletTransportBundle | null = null;
let activeEndpointsKey: string | null = null;
let activeSubKey: string | null = null;
let unsubFns: Array<() => void> = [];
let inFlightSync: Promise<void> | null = null;
let resyncRequested = false;
let subscribeGeneration = 0;
let lastSubAttemptFailedAt = 0;

export type MobileMainTab = 'wallet' | 'send' | 'receive' | 'glossary' | 'more';

export interface SpvCheckRecord {
  verified: boolean;
  blockHeight: number;
  merkleroot: string;
  pos: number;
  crossChecked?: boolean;
  error?: string;
}

export interface PendingDeepLinkTransfer {
  address: string;
  amountKrista?: string;
  label?: string;
  receivedAt: number;
}

export function useMobileWalletStore() {
  const storageMgr = new MobileWalletStorageManager(createCapacitorKeyValueStore());

  const hydrated = useState<boolean>('km-hydrated', () => false);
  const profiles = useState<StoredWalletProfile[]>('km-profiles', () => []);
  const activeProfileId = useState<string | null>('km-active-id', () => null);
  const sharedSessionState = useState<UnlockedWalletSession | null>('km-session', () => null);
  const session = shallowRef<UnlockedWalletSession | null>(sharedSessionState.value);

  const activeTab = useState<MobileMainTab>('km-tab', () => 'wallet');
  const snapshot = useState<WalletSyncSnapshot | null>('km-snapshot', () => null);
  const syncing = useState<boolean>('km-syncing', () => false);
  const connected = useState<boolean>('km-connected', () => false);
  const networkOnline = useState<boolean>('km-net-online', () => true);
  const syncError = useState<string | null>('km-sync-error', () => null);
  const lastConsensus = useState<TipConsensusReport | null>('km-consensus', () => null);
  const spvResults = useState<Record<string, SpvCheckRecord>>('km-spv', () => ({}));
  const autoLockMins = useState<number>('km-autolock', () => 5);
  const lockOnBackground = useState<boolean>('km-lock-bg', () => true);
  const hasQuickPin = useState<boolean>('km-has-pin', () => false);
  const pendingDeepLink = useState<PendingDeepLinkTransfer | null>('km-deeplink', () => null);
  const deepLinkNotice = useState<string | null>('km-deeplink-notice', () => null);

  const activeProfile = computed<StoredWalletProfile | null>(
    () => profiles.value.find((p) => p.id === activeProfileId.value) ?? profiles.value[0] ?? null
  );

  const hasWallet = computed(() => profiles.value.length > 0);
  const isWatchOnly = computed(() => activeProfile.value?.mode === 'watch_only');
  const isUnlocked = computed(() => {
    if (!activeProfile.value) return false;
    if (isWatchOnly.value) return true;
    const s = sharedSessionState.value;
    return Boolean(s && s.profileId === activeProfile.value.id);
  });

  const currentNetwork = computed<NetworkId>(() => activeProfile.value?.network ?? 'mainnet');
  const currentEndpoints = computed<NetworkEndpointsConfig>(
    () => activeProfile.value?.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[currentNetwork.value]
  );

  const platformInfo = computed(() => ({
    native: isNativePlatform(),
    platform: getPlatformName()
  }));

  const trackedAddresses = computed(() => {
    const prof = activeProfile.value;
    if (!prof) return { p2pkh: [] as string[], taproot: [] as string[], all: [] as string[] };
    const s = sharedSessionState.value;
    if (s && s.profileId === prof.id) {
      return s.listTrackedAddresses(prof.receiveCount, prof.taprootCount);
    }
    if (prof.mode === 'watch_only') {
      const all = deriveWatchOnlyAddressList(prof, prof.receiveCount);
      return {
        p2pkh: prof.publicAddresses.p2pkh.length ? prof.publicAddresses.p2pkh : all,
        taproot: prof.publicAddresses.taproot,
        all
      };
    }
    return {
      p2pkh: prof.publicAddresses.p2pkh,
      taproot: prof.publicAddresses.taproot,
      all: [...prof.publicAddresses.p2pkh, ...prof.publicAddresses.taproot]
    };
  });

  const refreshQuickPinStatus = async () => {
    if (!activeProfile.value || activeProfile.value.mode === 'watch_only') {
      hasQuickPin.value = false;
      return;
    }
    hasQuickPin.value = await storageMgr.hasQuickPin(activeProfile.value.id);
  };

  const hydrate = async () => {
    if (hydrated.value) return;
    const rawProfiles = await storageMgr.loadProfiles();
    const loadedProfiles = rawProfiles.map((p) => {
      const net = p.network ?? 'mainnet';
      try {
        return {
          ...p,
          endpoints: sanitizeEndpointsConfig(net, p.endpoints)
        };
      } catch {
        return {
          ...p,
          endpoints: DEFAULT_NETWORK_ENDPOINTS[net]
        };
      }
    });
    const activeId = await storageMgr.loadActiveProfileId(loadedProfiles);
    const [mins, lockBg] = await Promise.all([
      storageMgr.loadAutoLockMins(),
      storageMgr.loadLockOnBackground()
    ]);

    profiles.value = loadedProfiles;
    activeProfileId.value = activeId;
    autoLockMins.value = mins;
    lockOnBackground.value = lockBg;
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      networkOnline.value = navigator.onLine;
    }
    hydrated.value = true;
    await refreshQuickPinStatus();

    if (activeProfile.value?.mode === 'watch_only') {
      void refreshSync();
    }
  };

  const persist = async () => {
    await storageMgr.saveProfiles(profiles.value, activeProfileId.value);
  };

  const clearSubscriptions = (): void => {
    for (const fn of unsubFns) {
      try {
        fn();
      } catch {
        // ignore unsubscribe errors on teardown
      }
    }
    unsubFns = [];
    activeSubKey = null;
  };

  const stopAutoSyncLoop = (): void => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (autoSyncDebounce) {
      clearTimeout(autoSyncDebounce);
      autoSyncDebounce = null;
    }
    if (typeof document !== 'undefined' && visibilityListener) {
      document.removeEventListener('visibilitychange', visibilityListener);
      visibilityListener = null;
    }
  };

  const closeTransport = async (): Promise<void> => {
    subscribeGeneration++;
    lastSubAttemptFailedAt = 0;
    clearSubscriptions();
    if (activeTransport) {
      const old = activeTransport;
      activeTransport = null;
      activeEndpointsKey = null;
      await old.close().catch(() => {});
    }
    connected.value = false;
  };

  const clearIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const lockWallet = (): void => {
    clearIdleTimer();
    stopAutoSyncLoop();
    if (sharedSessionState.value) {
      sharedSessionState.value.wipe();
    }
    session.value = null;
    sharedSessionState.value = null;
    void closeTransport();
  };

  const touchActivity = (): void => {
    clearIdleTimer();
    if (!isUnlocked.value || isWatchOnly.value) return;
    if (typeof window === 'undefined') return;
    idleTimer = setTimeout(() => {
      lockWallet();
    }, autoLockMins.value * 60_000);
  };

  const handleAppBackground = (): void => {
    stopAutoSyncLoop();
    if (lockOnBackground.value) {
      lockWallet();
    } else if (isUnlocked.value && !isWatchOnly.value) {
      void storageMgr.saveBackgroundTimestamp(Date.now());
    }
  };

  const handleAppResume = async (): Promise<void> => {
    const ts = await storageMgr.loadBackgroundTimestamp();
    await storageMgr.saveBackgroundTimestamp(null);
    if (
      isUnlocked.value &&
      !isWatchOnly.value &&
      shouldAutoLockOnResume(ts, Date.now(), lockOnBackground.value, autoLockMins.value)
    ) {
      lockWallet();
    } else if (isUnlocked.value) {
      touchActivity();
      await closeTransport();
      void refreshSync();
    }
  };

  const applyIncomingLink = (rawUrl: string): boolean => {
    const parsed = parseIncomingMobileLink(rawUrl, currentNetwork.value);
    if (parsed.kind !== 'payment') return false;
    pendingDeepLink.value = {
      address: parsed.address,
      amountKrista: parsed.amountKrista,
      label: parsed.label,
      receivedAt: Date.now()
    };
    deepLinkNotice.value = parsed.address;
    if (isUnlocked.value) {
      activeTab.value = 'send';
    }
    return true;
  };

  const consumePendingDeepLink = (): PendingDeepLinkTransfer | null => {
    const current = pendingDeepLink.value;
    pendingDeepLink.value = null;
    return current;
  };

  const setAutoLockMinutes = async (mins: number) => {
    const clamped = Math.min(120, Math.max(1, Math.round(mins)));
    autoLockMins.value = clamped;
    await storageMgr.saveAutoLockMins(clamped);
    touchActivity();
  };

  const setLockOnBackgroundPref = async (enabled: boolean) => {
    lockOnBackground.value = enabled;
    await storageMgr.saveLockOnBackground(enabled);
  };

  const setSession = (next: UnlockedWalletSession) => {
    if (sharedSessionState.value && sharedSessionState.value !== next) {
      sharedSessionState.value.wipe();
    }
    session.value = next;
    sharedSessionState.value = next;
    if (pendingDeepLink.value) {
      activeTab.value = 'send';
    }
    touchActivity();
  };

  const canAutoSyncNow = (): boolean => {
    if (!activeProfile.value) return false;
    if (!networkOnline.value) return false;
    if (activeProfile.value.mode !== 'watch_only' && !sharedSessionState.value) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    return true;
  };

  const getOrCreateTransport = (): WalletTransportBundle => {
    const network = currentNetwork.value;
    const endpoints = currentEndpoints.value;
    const endpointsKey = `${network}|${endpoints.electrumUrls.join(',')}|${endpoints.explorerUrl}`;
    if (!activeTransport) {
      activeTransport = createWalletTransport(network, endpoints);
      activeEndpointsKey = endpointsKey;
    }
    return activeTransport;
  };

  const scheduleDebouncedSync = (): void => {
    if (typeof window === 'undefined') return;
    if (!canAutoSyncNow()) return;
    if (autoSyncDebounce) clearTimeout(autoSyncDebounce);
    autoSyncDebounce = setTimeout(() => {
      autoSyncDebounce = null;
      if (canAutoSyncNow()) {
        void refreshSync({ silent: true });
      }
    }, AUTO_SYNC_DEBOUNCE_MS);
  };

  const startAutoSyncLoop = (): void => {
    if (typeof window === 'undefined') return;
    const prof = activeProfile.value;
    if (!prof) return;
    if (prof.mode !== 'watch_only' && !sharedSessionState.value) return;

    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (canAutoSyncNow()) {
          void refreshSync({ silent: true });
        }
      }, AUTO_SYNC_POLL_MS);
    }

    if (typeof document !== 'undefined' && !visibilityListener) {
      visibilityListener = () => {
        if (document.visibilityState === 'visible' && canAutoSyncNow()) {
          touchActivity();
          scheduleDebouncedSync();
        }
      };
      document.addEventListener('visibilitychange', visibilityListener);
    }
  };

  const ensureSubscribedTransport = async (
    prof: StoredWalletProfile,
    endpoints: NetworkEndpointsConfig,
    addrs: string[],
    forceSubscribeRetry: boolean
  ): Promise<WalletTransportBundle | null> => {
    const endpointsKey = `${prof.network}|${endpoints.electrumUrls.join(',')}|${endpoints.explorerUrl}`;
    const subKey = `${prof.id}|${endpointsKey}|${addrs.join(',')}`;

    if (activeTransport && activeEndpointsKey !== endpointsKey) {
      await closeTransport();
    }
    if (!activeTransport) {
      activeTransport = createWalletTransport(prof.network, endpoints);
      activeEndpointsKey = endpointsKey;
    }

    const allowLiveSub = prof.mode === 'watch_only' || Boolean(sharedSessionState.value);
    if (!allowLiveSub) {
      return activeTransport;
    }
    if (activeSubKey === subKey) {
      return activeTransport;
    }
    if (
      !forceSubscribeRetry &&
      lastSubAttemptFailedAt > 0 &&
      Date.now() - lastSubAttemptFailedAt < SUBSCRIPTION_RETRY_COOLDOWN_MS
    ) {
      return activeTransport;
    }

    clearSubscriptions();
    const gen = ++subscribeGeneration;

    for (const electrum of activeTransport.electrums) {
      const localUnsubs: Array<() => void> = [];
      try {
        let initializedHeaders = false;
        let lastHeaderKey: string | null = null;
        const unsubH = await electrum.subscribeHeaders((tip) => {
          const tipKey = `${tip.height}:${tip.hash ?? ''}`;
          if (!initializedHeaders) {
            initializedHeaders = true;
            lastHeaderKey = tipKey;
            return;
          }
          if (tipKey === lastHeaderKey) return;
          lastHeaderKey = tipKey;
          scheduleDebouncedSync();
        });
        if (gen !== subscribeGeneration || !activeTransport) {
          try {
            unsubH();
          } catch {}
          return null;
        }
        localUnsubs.push(unsubH);

        for (const addr of addrs) {
          let initializedAddr = false;
          let lastStatus: string | null = null;
          const unsubA = await electrum.subscribeAddress(addr, (statusHash) => {
            if (!initializedAddr) {
              initializedAddr = true;
              lastStatus = statusHash;
              return;
            }
            if (statusHash === lastStatus) return;
            lastStatus = statusHash;
            scheduleDebouncedSync();
          });
          if (gen !== subscribeGeneration || !activeTransport) {
            try {
              unsubA();
            } catch {}
            for (const fn of localUnsubs) {
              try {
                fn();
              } catch {}
            }
            return null;
          }
          localUnsubs.push(unsubA);
        }

        unsubFns = localUnsubs;
        activeSubKey = subKey;
        lastSubAttemptFailedAt = 0;
        return activeTransport;
      } catch {
        for (const fn of localUnsubs) {
          try {
            fn();
          } catch {}
        }
      }
    }

    activeSubKey = null;
    lastSubAttemptFailedAt = Date.now();
    return activeTransport;
  };

  const refreshSync = async (options?: { silent?: boolean }): Promise<void> => {
    const silent =
      options && typeof options === 'object' && 'silent' in options ? Boolean(options.silent) : false;

    if (inFlightSync) {
      if (!silent) {
        resyncRequested = true;
      }
      return inFlightSync;
    }

    const prof = activeProfile.value;
    if (!prof) return;
    if (!networkOnline.value) return;
    const addrs = trackedAddresses.value.all;
    if (addrs.length === 0) return;

    const endpoints = currentEndpoints.value;

    const run = async (): Promise<void> => {
      if (!silent) {
        syncing.value = true;
      }
      syncError.value = null;
      try {
        const bundle = await ensureSubscribedTransport(prof, endpoints, addrs, !silent);
        if (!bundle || activeProfile.value?.id !== prof.id) return;
        const snap = await syncWalletState(bundle.transport, addrs, prof.network);
        if (activeProfile.value?.id !== prof.id) return;
        snapshot.value = snap;
        connected.value = true;
        startAutoSyncLoop();
      } catch (err) {
        connected.value = false;
        clearSubscriptions();
        lastSubAttemptFailedAt = Date.now();
        if (!silent || !snapshot.value) {
          syncError.value = err instanceof Error ? err.message : String(err);
        }
        startAutoSyncLoop();
      } finally {
        if (!silent) {
          syncing.value = false;
        }
        inFlightSync = null;
        if (resyncRequested) {
          resyncRequested = false;
          void refreshSync();
        }
      }
    };

    inFlightSync = run();
    return inFlightSync;
  };

  const syncProfileDerivedAddresses = async (
    prof: StoredWalletProfile,
    unlocked: UnlockedWalletSession
  ): Promise<void> => {
    const tracked = unlocked.listTrackedAddresses(prof.receiveCount, prof.taprootCount);
    const nextAddrs = {
      p2pkh: tracked.p2pkh,
      taproot: prof.mode === 'hd' ? tracked.taproot : []
    };
    if (JSON.stringify(nextAddrs) !== JSON.stringify(prof.publicAddresses)) {
      const updatedProf: StoredWalletProfile = {
        ...prof,
        publicAddresses: nextAddrs
      };
      profiles.value = profiles.value.map((p) => (p.id === updatedProf.id ? updatedProf : p));
      await persist();
    }
  };

  const createHd = async (params: {
    label?: string;
    password: string;
    network: NetworkId;
    wordCount: 12 | 24;
    passphrase?: string;
  }): Promise<string> => {
    const res = await createHdWalletProfile(params);
    profiles.value = [...profiles.value, res.profile];
    activeProfileId.value = res.profile.id;
    await persist();
    await closeTransport();
    setSession(res.session);
    activeTab.value = 'wallet';
    await refreshQuickPinStatus();
    void refreshSync();
    return res.mnemonic;
  };

  const restoreMnemonic = async (params: {
    label?: string;
    mnemonic: string;
    passphrase?: string;
    password: string;
    network: NetworkId;
  }) => {
    const res = await restoreFromMnemonicProfile(params);
    profiles.value = [...profiles.value, res.profile];
    activeProfileId.value = res.profile.id;
    await persist();
    await closeTransport();
    setSession(res.session);
    activeTab.value = 'wallet';
    await refreshQuickPinStatus();
    void refreshSync();
  };

  const restoreWif = async (params: {
    label?: string;
    keyInput: string;
    bip38Passphrase?: string;
    password: string;
    network: NetworkId;
  }) => {
    const res = await restoreFromWifOrBip38Profile(params);
    profiles.value = [...profiles.value, res.profile];
    activeProfileId.value = res.profile.id;
    await persist();
    await closeTransport();
    setSession(res.session);
    activeTab.value = 'wallet';
    await refreshQuickPinStatus();
    void refreshSync();
  };

  const addWatchOnly = async (params: { label?: string; input: string; network: NetworkId }) => {
    const prof = createWatchOnlyProfile(params);
    profiles.value = [...profiles.value, prof];
    activeProfileId.value = prof.id;
    await persist();
    await closeTransport();
    lockWallet();
    activeTab.value = 'wallet';
    await refreshQuickPinStatus();
    void refreshSync();
  };

  const unlockWithPassword = async (password: string): Promise<boolean> => {
    const prof = activeProfile.value;
    if (!prof) return false;
    const guard = unlockGuardByProfile.get(prof.id) ?? { failCount: 0, blockedUntil: 0 };
    if (guard.blockedUntil > Date.now()) {
      const sec = Math.max(1, Math.ceil((guard.blockedUntil - Date.now()) / 1000));
      void hapticNotify('error');
      throw new Error(`Too many failed unlock attempts. Try again in ${sec}s.`);
    }
    try {
      const unlocked = await unlockWalletProfile(prof, password);
      unlockGuardByProfile.delete(prof.id);
      await syncProfileDerivedAddresses(prof, unlocked);
      setSession(unlocked);
      await refreshQuickPinStatus();
      void hapticNotify('success');
      void refreshSync();
      return true;
    } catch {
      const nextFail = guard.failCount + 1;
      const waitMs = UNLOCK_BACKOFF_MS[Math.min(nextFail, UNLOCK_BACKOFF_MS.length - 1)] ?? 60_000;
      unlockGuardByProfile.set(prof.id, {
        failCount: nextFail,
        blockedUntil: waitMs > 0 ? Date.now() + waitMs : 0
      });
      void hapticNotify('error');
      return false;
    }
  };

  const enableQuickPin = async (vaultPassword: string, pin: string): Promise<void> => {
    const prof = activeProfile.value;
    if (!prof) throw new Error('No active wallet');
    await storageMgr.enableQuickPin(prof, vaultPassword, pin);
    hasQuickPin.value = true;
    void hapticNotify('success');
  };

  const disableQuickPin = async (): Promise<void> => {
    const prof = activeProfile.value;
    if (!prof) return;
    await storageMgr.disableQuickPin(prof.id);
    hasQuickPin.value = false;
  };

  const unlockWithPin = async (
    pin: string
  ): Promise<{
    ok: boolean;
    remainingAttempts: number;
    wiped: boolean;
  }> => {
    const prof = activeProfile.value;
    if (!prof) return { ok: false, remainingAttempts: 0, wiped: false };

    const res = await storageMgr.unlockWithQuickPin(prof, pin);
    if (res.ok) {
      unlockGuardByProfile.delete(prof.id);
      await syncProfileDerivedAddresses(prof, res.session);
      setSession(res.session);
      void hapticNotify('success');
      void refreshSync();
      return { ok: true, remainingAttempts: MAX_PIN_ATTEMPTS, wiped: false };
    }
    void hapticNotify('error');
    if (res.wiped) {
      hasQuickPin.value = false;
    }
    return {
      ok: false,
      remainingAttempts: res.remainingAttempts,
      wiped: res.wiped
    };
  };

  const revealRecoverySeedWithPassword = async (password: string): Promise<string> => {
    const prof = activeProfile.value;
    if (!prof) throw new Error('No active wallet');
    return revealWalletMnemonic(prof, password);
  };

  const incrementAddressIndex = async (kind: 'p2pkh' | 'taproot') => {
    const prof = activeProfile.value;
    if (!prof || prof.mode === 'wif') return;
    const s = sharedSessionState.value;

    let nextP2pkhCount = prof.receiveCount;
    let nextTapCount = prof.taprootCount;
    let p2pkhList = [...prof.publicAddresses.p2pkh];
    let tapList = [...prof.publicAddresses.taproot];

    if (kind === 'p2pkh') {
      nextP2pkhCount++;
      if (s && s.profileId === prof.id) {
        p2pkhList = s.listTrackedAddresses(nextP2pkhCount, nextTapCount).p2pkh;
      } else if (prof.watchOnly?.kind === 'xpub') {
        p2pkhList = deriveWatchOnlyAddressList(prof, nextP2pkhCount);
      }
    } else if (prof.mode === 'hd') {
      nextTapCount++;
      if (s && s.profileId === prof.id) {
        tapList = s.listTrackedAddresses(nextP2pkhCount, nextTapCount).taproot;
      }
    }

    const updated: StoredWalletProfile = {
      ...prof,
      receiveCount: nextP2pkhCount,
      taprootCount: nextTapCount,
      publicAddresses: { p2pkh: p2pkhList, taproot: tapList }
    };
    profiles.value = profiles.value.map((p) => (p.id === updated.id ? updated : p));
    await persist();
    touchActivity();
    void refreshSync();
  };

  const updateEndpointsAndNetwork = async (
    nextNetwork: NetworkId,
    electrumUrls: string[],
    explorerUrl: string
  ) => {
    const prof = activeProfile.value;
    if (!prof) return;
    const cleanElectrum = electrumUrls.map((u) => u.trim()).filter(Boolean);
    const defaultEp = DEFAULT_NETWORK_ENDPOINTS[nextNetwork];
    const cleanExplorer = explorerUrl.trim();
    const safeEndpoints = sanitizeEndpointsConfig(nextNetwork, {
      electrumUrls: cleanElectrum.length ? cleanElectrum : defaultEp.electrumUrls,
      explorerUrl: cleanExplorer ? cleanExplorer : undefined,
      explorerBrowserUrl: defaultEp.explorerBrowserUrl
    });

    const networkChanged = nextNetwork !== prof.network;
    const updated: StoredWalletProfile = {
      ...prof,
      network: nextNetwork,
      endpoints: safeEndpoints
    };
    profiles.value = profiles.value.map((p) => (p.id === updated.id ? updated : p));
    await persist();
    await closeTransport();
    if (networkChanged) {
      snapshot.value = null;
      spvResults.value = {};
      if (!isWatchOnly.value) {
        lockWallet();
        return;
      }
    }
    void refreshSync();
  };

  const verifySelectedTransactionInputs = async (signedTx: SignedTransaction): Promise<void> => {
    const snap = snapshot.value;
    if (!snap) return;
    const bundle = getOrCreateTransport();
    await verifySelectedInputsOnline(bundle, signedTx.tx.inputs, snap.utxos);
  };

  const exportEncryptedBackup = (): string => {
    const prof = activeProfile.value;
    if (!prof) {
      throw new Error('No active wallet');
    }
    if (!isUnlocked.value && !isWatchOnly.value) {
      throw new Error('Unlock wallet before exporting vault backup');
    }
    return JSON.stringify(prof, null, 2);
  };

  const verifyTxSpv = async (txid: string): Promise<SpvCheckRecord> => {
    const bundle = getOrCreateTransport();
    const res = await verifyTransactionSpv(bundle, txid);
    spvResults.value = { ...spvResults.value, [txid]: res };
    touchActivity();
    return res;
  };

  const broadcastRawTx = async (rawHex: string): Promise<string> => {
    const bundle = getOrCreateTransport();
    const txid = await bundle.transport.broadcastTransaction(rawHex);
    touchActivity();
    setTimeout(() => {
      void refreshSync();
    }, 800);
    return txid;
  };

  const checkConsensus = async (): Promise<TipConsensusReport> => {
    const report = await checkMultiServerConsensus(
      currentEndpoints.value.electrumUrls,
      currentNetwork.value
    );
    lastConsensus.value = report;
    return report;
  };

  const wipeActiveProfile = async () => {
    const prof = activeProfile.value;
    if (!prof) return;
    await storageMgr.disableQuickPin(prof.id);
    lockWallet();
    profiles.value = profiles.value.filter((p) => p.id !== prof.id);
    activeProfileId.value = profiles.value[0]?.id ?? null;
    snapshot.value = null;
    hasQuickPin.value = false;
    await closeTransport();
    await persist();
    await refreshQuickPinStatus();
  };

  const selectProfile = async (id: string) => {
    if (activeProfileId.value === id) return;
    lockWallet();
    activeProfileId.value = id;
    snapshot.value = null;
    await persist();
    await closeTransport();
    await refreshQuickPinStatus();
    if (activeProfile.value?.mode === 'watch_only') {
      void refreshSync();
    }
  };

  return {
    hydrated,
    profiles,
    activeProfileId,
    activeProfile,
    session: sharedSessionState,
    activeTab,
    snapshot,
    syncing,
    connected,
    networkOnline,
    syncError,
    lastConsensus,
    spvResults,
    autoLockMins,
    lockOnBackground,
    hasQuickPin,
    pendingDeepLink,
    deepLinkNotice,
    hasWallet,
    isWatchOnly,
    isUnlocked,
    currentNetwork,
    currentEndpoints,
    platformInfo,
    trackedAddresses,
    hydrate,
    touchActivity,
    handleAppBackground,
    handleAppResume,
    applyIncomingLink,
    consumePendingDeepLink,
    lockWallet,
    setAutoLockMinutes,
    setLockOnBackgroundPref,
    refreshSync,
    createHd,
    restoreMnemonic,
    restoreWif,
    addWatchOnly,
    unlockWithPassword,
    enableQuickPin,
    disableQuickPin,
    unlockWithPin,
    revealRecoverySeedWithPassword,
    exportEncryptedBackup,
    incrementAddressIndex,
    updateEndpointsAndNetwork,
    verifySelectedTransactionInputs,
    verifyTxSpv,
    broadcastRawTx,
    checkConsensus,
    wipeActiveProfile,
    selectProfile
  };
}
