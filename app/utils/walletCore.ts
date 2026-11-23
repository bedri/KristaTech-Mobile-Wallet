import {
  ElectrumWsTransport,
  ExplorerRestTransport,
  FailoverTransport,
  HDWallet,
  addressToScriptPubKey,
  bip38Decrypt,
  buildAndSignTransaction,
  buildCltvTimelockScript,
  buildP2pkhScript,
  bytesToHex,
  classifyScriptPubKey,
  createPsbt,
  decodeAddress,
  decodePsbt,
  decodeWif,
  decryptVault,
  derivePubkeyHash,
  deriveWatchOnlyP2pkh,
  encodePsbtBase64,
  encodeWif,
  encryptVault,
  estimateMinRelayFee,
  evaluateTipConsensus,
  extractTransactionFromPsbt,
  finalizePsbt,
  formatPaymentUri,
  generateMnemonic,
  getNetwork,
  getPsbtInputUtxo,
  getTxid,
  hexToBytes,
  inspectPsbtSummary,
  kristaToSatoshis,
  partitionUtxos,
  pubkeyHashToAddress,
  sanitizeExplorerBrowserUrl,
  satoshisToKrista,
  scriptToScripthash,
  selectUtxosLargestFirst,
  serializeTransaction,
  signPsbtInput,
  utf8ToBytes,
  validateElectrumUrl,
  validateExplorerApiUrl,
  validateMnemonic,
  verifyMerkleProof,
  verifyUtxoAgainstRawTx,
  zeroBytes,
  type AddressHistoryItem,
  type DerivedP2pkhAccountKey,
  type DerivedTaprootAccountKey,
  type EncryptedVault,
  type FeeEstimate,
  type LightWalletTransport,
  type NetworkId,
  type PsbtDetailedOutputSummary,
  type ScriptType,
  type ServerTip,
  type SignableUtxo,
  type SignedTransaction,
  type TipConsensusReport,
  type Transaction,
  type TransactionDestination,
  type TxInput,
  type Utxo
} from '@kristatech/sdk';
import { parseIncomingMobileLink } from './deepLink.ts';

export interface NetworkEndpointsConfig {
  readonly electrumUrls: string[];
  readonly explorerUrl?: string;
  readonly explorerBrowserUrl: string;
}

export const DEFAULT_NETWORK_ENDPOINTS: Readonly<Record<NetworkId, NetworkEndpointsConfig>> =
  Object.freeze({
    mainnet: Object.freeze({
      electrumUrls: ['wss://electrum.kristalteknoloji.com'],
      explorerUrl: 'https://explorer.kristalteknoloji.com',
      explorerBrowserUrl: 'https://explorer.kristalteknoloji.com'
    }),
    testnet: Object.freeze({
      electrumUrls: ['wss://testnet-electrum.kristatech.org:50004'],
      explorerUrl: 'https://testnet.kristatech.org/api',
      explorerBrowserUrl: 'https://testnet.kristatech.org'
    }),
    regtest: Object.freeze({
      electrumUrls: ['ws://127.0.0.1:50003'],
      explorerUrl: 'http://127.0.0.1:27799/api',
      explorerBrowserUrl: 'http://127.0.0.1:27799'
    })
  });

export type WalletMode = 'hd' | 'wif' | 'watch_only';

export type VaultSecretPayload =
  | {
      readonly kind: 'hd';
      readonly mnemonic: string;
      readonly passphrase: string;
    }
  | {
      readonly kind: 'wif';
      readonly privateKeyHex: string;
      readonly compressed: boolean;
    };

export type WatchOnlyConfig =
  | {
      readonly kind: 'xpub';
      readonly xpub: string;
    }
  | {
      readonly kind: 'addresses';
      readonly addresses: string[];
    };

export interface StoredWalletProfile {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly network: NetworkId;
  readonly mode: WalletMode;
  readonly vault?: EncryptedVault;
  readonly watchOnly?: WatchOnlyConfig;
  readonly receiveCount: number;
  readonly taprootCount: number;
  readonly publicAddresses: {
    readonly p2pkh: string[];
    readonly taproot: string[];
  };
  readonly endpoints: NetworkEndpointsConfig;
  readonly createdAt: string;
}

export interface SignableKeyEntry {
  readonly privateKey: Uint8Array;
  readonly address: string;
  readonly pubkeyHashHex?: string;
  readonly scriptHex: string;
  readonly isTaproot: boolean;
}

function makeProfileId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function assertValidWalletPassword(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('Wallet password must be at least 8 characters');
  }
}

export class UnlockedWalletSession {
  readonly profileId: string;
  readonly mode: 'hd' | 'wif';
  readonly network: NetworkId;

  private hdWallet: HDWallet | null = null;
  private wifPrivKey: Uint8Array | null = null;
  private readonly p2pkhCache = new Map<number, DerivedP2pkhAccountKey>();
  private readonly taprootCache = new Map<number, DerivedTaprootAccountKey>();
  private wiped = false;

  constructor(options: {
    profileId: string;
    network: NetworkId;
    payload: VaultSecretPayload;
  }) {
    this.profileId = options.profileId;
    this.network = options.network;

    if (options.payload.kind === 'hd') {
      this.mode = 'hd';
      this.hdWallet = HDWallet.fromMnemonic(
        options.payload.mnemonic,
        options.network,
        options.payload.passphrase
      );
    } else {
      this.mode = 'wif';
      this.wifPrivKey = hexToBytes(options.payload.privateKeyHex);
    }
  }

  private assertActive(): void {
    if (this.wiped) {
      throw new Error('Wallet session has been locked and wiped from memory');
    }
  }

  deriveP2pkh(index: number): DerivedP2pkhAccountKey {
    this.assertActive();
    if (this.mode === 'wif') {
      if (index !== 0) {
        throw new Error('Single-key WIF wallet only holds address index 0');
      }
      const cached = this.p2pkhCache.get(0);
      if (cached) return cached;

      const priv = this.wifPrivKey!;
      const privCopy = new Uint8Array(priv);
      const net = this.network;
      const pubkeyHash = derivePubkeyHash(privCopy);
      const address = pubkeyHashToAddress(pubkeyHash, net);
      const scriptPubKey = buildP2pkhScript(pubkeyHash);
      const derived: DerivedP2pkhAccountKey = {
        path: 'imported-wif',
        index: 0,
        change: 0,
        privateKey: privCopy,
        publicKey: new Uint8Array(0),
        xOnlyPubkey: new Uint8Array(0),
        pubkeyHash,
        address,
        scriptPubKey,
        scripthash: scriptToScripthash(scriptPubKey),
        get wif(): string {
          return encodeWif(privCopy, net, true);
        }
      };
      this.p2pkhCache.set(0, derived);
      return derived;
    }

    let entry = this.p2pkhCache.get(index);
    if (!entry) {
      entry = this.hdWallet!.deriveP2pkh(index, 0, 0);
      this.p2pkhCache.set(index, entry);
    }
    return entry;
  }

  deriveTaproot(index: number): DerivedTaprootAccountKey | null {
    this.assertActive();
    if (this.mode === 'wif' || !this.hdWallet) {
      return null;
    }
    let entry = this.taprootCache.get(index);
    if (!entry) {
      entry = this.hdWallet.deriveTaproot(index, 0, 0);
      this.taprootCache.set(index, entry);
    }
    return entry;
  }

  getAccountXpub(): string | null {
    this.assertActive();
    return this.hdWallet ? this.hdWallet.getAccountXpub(0, 44) : null;
  }

  listTrackedAddresses(
    receiveCount: number,
    taprootCount: number
  ): { p2pkh: string[]; taproot: string[]; all: string[] } {
    this.assertActive();
    const p2pkh: string[] = [];
    const taproot: string[] = [];
    const maxP2pkh = this.mode === 'wif' ? 1 : Math.max(1, receiveCount);
    for (let i = 0; i < maxP2pkh; i++) {
      p2pkh.push(this.deriveP2pkh(i).address);
    }
    if (this.mode === 'hd') {
      const maxTap = Math.max(1, taprootCount);
      for (let i = 0; i < maxTap; i++) {
        const tap = this.deriveTaproot(i);
        if (tap) taproot.push(tap.address);
      }
    }
    return { p2pkh, taproot, all: [...p2pkh, ...taproot] };
  }

  getSignableKeyMap(receiveCount: number, taprootCount: number): SignableKeyEntry[] {
    this.assertActive();
    const list: SignableKeyEntry[] = [];
    const maxP2pkh = this.mode === 'wif' ? 1 : Math.max(1, receiveCount);
    for (let i = 0; i < maxP2pkh; i++) {
      const k = this.deriveP2pkh(i);
      list.push({
        privateKey: k.privateKey,
        address: k.address,
        pubkeyHashHex: bytesToHex(k.pubkeyHash),
        scriptHex: bytesToHex(k.scriptPubKey),
        isTaproot: false
      });
    }
    if (this.mode === 'hd') {
      const maxTap = Math.max(1, taprootCount);
      for (let i = 0; i < maxTap; i++) {
        const tap = this.deriveTaproot(i);
        if (tap) {
          list.push({
            privateKey: tap.privateKey,
            address: tap.address,
            scriptHex: bytesToHex(tap.scriptPubKey),
            isTaproot: true
          });
        }
      }
    }
    return list;
  }

  wipe(): void {
    if (this.wiped) return;
    this.wiped = true;
    if (this.wifPrivKey) {
      zeroBytes(this.wifPrivKey);
      this.wifPrivKey = null;
    }
    for (const k of this.p2pkhCache.values()) {
      zeroBytes(k.privateKey);
    }
    for (const k of this.taprootCache.values()) {
      zeroBytes(k.privateKey);
      zeroBytes(k.tweakedPrivateKey);
    }
    this.p2pkhCache.clear();
    this.taprootCache.clear();
    this.hdWallet?.wipe();
    this.hdWallet = null;
  }
}

export async function createHdWalletProfile(params: {
  label?: string;
  password: string;
  network?: NetworkId;
  wordCount?: 12 | 24;
  passphrase?: string;
  endpoints?: NetworkEndpointsConfig;
}): Promise<{ profile: StoredWalletProfile; session: UnlockedWalletSession; mnemonic: string }> {
  assertValidWalletPassword(params.password);
  const network = params.network ?? 'mainnet';
  const mnemonic = generateMnemonic(params.wordCount ?? 12);
  const passphrase = params.passphrase ?? '';

  const payload: VaultSecretPayload = { kind: 'hd', mnemonic, passphrase };
  const vault = await encryptVault(JSON.stringify(payload), params.password);
  const id = makeProfileId();
  const session = new UnlockedWalletSession({ profileId: id, network, payload });
  const initial = session.listTrackedAddresses(1, 1);

  const profile: StoredWalletProfile = {
    version: 1,
    id,
    label: params.label?.trim() || 'KRISTA Mobile Wallet',
    network,
    mode: 'hd',
    vault,
    receiveCount: 1,
    taprootCount: 1,
    publicAddresses: { p2pkh: initial.p2pkh, taproot: initial.taproot },
    endpoints: params.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[network],
    createdAt: new Date().toISOString()
  };

  return { profile, session, mnemonic };
}

export async function restoreFromMnemonicProfile(params: {
  label?: string;
  mnemonic: string;
  passphrase?: string;
  password: string;
  network?: NetworkId;
  endpoints?: NetworkEndpointsConfig;
}): Promise<{ profile: StoredWalletProfile; session: UnlockedWalletSession }> {
  assertValidWalletPassword(params.password);
  const normalized = params.mnemonic.trim().replace(/\s+/g, ' ');
  if (!validateMnemonic(normalized)) {
    throw new Error('Invalid BIP39 recovery phrase');
  }
  const network = params.network ?? 'mainnet';
  const payload: VaultSecretPayload = {
    kind: 'hd',
    mnemonic: normalized,
    passphrase: params.passphrase ?? ''
  };
  const vault = await encryptVault(JSON.stringify(payload), params.password);
  const id = makeProfileId();
  const session = new UnlockedWalletSession({ profileId: id, network, payload });
  const initial = session.listTrackedAddresses(1, 1);

  const profile: StoredWalletProfile = {
    version: 1,
    id,
    label: params.label?.trim() || 'Restored HD Wallet',
    network,
    mode: 'hd',
    vault,
    receiveCount: 1,
    taprootCount: 1,
    publicAddresses: { p2pkh: initial.p2pkh, taproot: initial.taproot },
    endpoints: params.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[network],
    createdAt: new Date().toISOString()
  };

  return { profile, session };
}

export async function restoreFromWifOrBip38Profile(params: {
  label?: string;
  keyInput: string;
  bip38Passphrase?: string;
  password: string;
  network?: NetworkId;
  endpoints?: NetworkEndpointsConfig;
}): Promise<{ profile: StoredWalletProfile; session: UnlockedWalletSession }> {
  assertValidWalletPassword(params.password);
  const network = params.network ?? 'mainnet';
  const cleanKey = params.keyInput.trim();

  let privateKey: Uint8Array;
  let compressed = true;

  if (cleanKey.startsWith('6P')) {
    if (!params.bip38Passphrase) {
      throw new Error('BIP38 passphrase is required for 6P encrypted keys');
    }
    const dec = bip38Decrypt(cleanKey, params.bip38Passphrase, network);
    privateKey = dec.privateKey;
    compressed = dec.compressed;
  } else {
    const dec = decodeWif(cleanKey, network);
    privateKey = dec.privateKey;
    compressed = dec.compressed;
  }

  const payload: VaultSecretPayload = {
    kind: 'wif',
    privateKeyHex: bytesToHex(privateKey),
    compressed
  };
  zeroBytes(privateKey);

  const vault = await encryptVault(JSON.stringify(payload), params.password);
  const id = makeProfileId();
  const session = new UnlockedWalletSession({ profileId: id, network, payload });
  const initial = session.listTrackedAddresses(1, 0);

  const profile: StoredWalletProfile = {
    version: 1,
    id,
    label: params.label?.trim() || 'Imported Key Wallet',
    network,
    mode: 'wif',
    vault,
    receiveCount: 1,
    taprootCount: 0,
    publicAddresses: { p2pkh: initial.p2pkh, taproot: [] },
    endpoints: params.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[network],
    createdAt: new Date().toISOString()
  };

  return { profile, session };
}

export function createWatchOnlyProfile(params: {
  label?: string;
  input: string;
  network?: NetworkId;
  endpoints?: NetworkEndpointsConfig;
}): StoredWalletProfile {
  const network = params.network ?? 'mainnet';
  const trimmed = params.input.trim();
  if (!trimmed) {
    throw new Error('Provide an extended public key (xpub/tpub) or one or more KRISTA addresses');
  }

  let watchOnly: WatchOnlyConfig | null = null;
  let p2pkh: string[] = [];
  const taproot: string[] = [];

  if (!/[\s,;]/.test(trimmed) && trimmed.length >= 80) {
    try {
      const derived = deriveWatchOnlyP2pkh(trimmed, 0, 0, network);
      watchOnly = { kind: 'xpub', xpub: trimmed };
      p2pkh = [derived.address];
    } catch {
      watchOnly = null;
    }
  }

  if (!watchOnly) {
    const parts = trimmed
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const validAddrs: string[] = [];
    for (const addr of parts) {
      const dec = decodeAddress(addr, network);
      if (dec.type === 'p2tr') {
        if (!taproot.includes(dec.address)) taproot.push(dec.address);
      } else {
        if (!p2pkh.includes(dec.address)) p2pkh.push(dec.address);
      }
      validAddrs.push(dec.address);
    }
    if (validAddrs.length === 0) {
      throw new Error('No valid KRISTA addresses found');
    }
    watchOnly = { kind: 'addresses', addresses: validAddrs };
  }

  return {
    version: 1,
    id: makeProfileId(),
    label: params.label?.trim() || 'Watch-Only Wallet',
    network,
    mode: 'watch_only',
    watchOnly,
    receiveCount: Math.max(1, p2pkh.length),
    taprootCount: taproot.length,
    publicAddresses: { p2pkh, taproot },
    endpoints: params.endpoints ?? DEFAULT_NETWORK_ENDPOINTS[network],
    createdAt: new Date().toISOString()
  };
}

export async function unlockWalletProfile(
  profile: StoredWalletProfile,
  password: string
): Promise<UnlockedWalletSession> {
  if (profile.mode === 'watch_only' || !profile.vault) {
    throw new Error('Watch-only wallets have no private keys to unlock');
  }
  const jsonText = await decryptVault(profile.vault, password);
  const payload = JSON.parse(jsonText) as VaultSecretPayload;
  return new UnlockedWalletSession({
    profileId: profile.id,
    network: profile.network,
    payload
  });
}

export async function revealWalletMnemonic(
  profile: StoredWalletProfile,
  password: string
): Promise<string> {
  if (profile.mode !== 'hd' || !profile.vault) {
    throw new Error('This wallet mode has no BIP39 mnemonic');
  }
  const jsonText = await decryptVault(profile.vault, password);
  const payload = JSON.parse(jsonText) as VaultSecretPayload;
  if (payload.kind !== 'hd') {
    throw new Error('This wallet mode has no BIP39 mnemonic');
  }
  return payload.mnemonic;
}

export async function rederiveProfileForNetwork(
  profile: StoredWalletProfile,
  password: string,
  nextNetwork: NetworkId
): Promise<{ profile: StoredWalletProfile; session: UnlockedWalletSession }> {
  if (profile.mode === 'watch_only' || !profile.vault) {
    throw new Error('Watch-only wallets cannot unlock private keys');
  }
  const jsonText = await decryptVault(profile.vault, password);
  const payload = JSON.parse(jsonText) as VaultSecretPayload;
  const session = new UnlockedWalletSession({
    profileId: profile.id,
    network: nextNetwork,
    payload
  });
  const addrs = session.listTrackedAddresses(profile.receiveCount, profile.taprootCount);
  return {
    session,
    profile: {
      ...profile,
      network: nextNetwork,
      publicAddresses: { p2pkh: addrs.p2pkh, taproot: addrs.taproot }
    }
  };
}

export function deriveWatchOnlyAddressList(
  profile: StoredWalletProfile,
  count: number
): string[] {
  if (profile.watchOnly?.kind === 'xpub') {
    const list: string[] = [];
    for (let i = 0; i < Math.max(1, count); i++) {
      list.push(deriveWatchOnlyP2pkh(profile.watchOnly.xpub, i, 0, profile.network).address);
    }
    return list;
  }
  return [...profile.publicAddresses.p2pkh, ...profile.publicAddresses.taproot];
}

export interface WalletTransportBundle {
  readonly transport: FailoverTransport;
  readonly electrums: ElectrumWsTransport[];
  readonly explorer: ExplorerRestTransport | null;
  readonly close: () => Promise<void>;
}

export function sanitizeEndpointsConfig(
  network: NetworkId,
  endpoints: NetworkEndpointsConfig
): NetworkEndpointsConfig {
  const electrumUrls = (endpoints.electrumUrls ?? [])
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => validateElectrumUrl(u, network));
  const rawExpApi = endpoints.explorerUrl?.trim() ?? '';
  const explorerUrl = rawExpApi ? validateExplorerApiUrl(rawExpApi, network) : undefined;
  const rawBrowser = endpoints.explorerBrowserUrl?.trim() ?? '';
  const explorerBrowserUrl = sanitizeExplorerBrowserUrl(rawBrowser, network);
  if (rawBrowser && !explorerBrowserUrl) {
    throw new Error(`Invalid explorer browser URL on ${network}: require https://`);
  }
  if (electrumUrls.length === 0 && !explorerUrl) {
    throw new Error('Configure at least one Electrum WebSocket URL or Explorer API URL');
  }
  return { electrumUrls, explorerUrl, explorerBrowserUrl };
}

export function createWalletTransport(
  network: NetworkId,
  endpoints: NetworkEndpointsConfig
): WalletTransportBundle {
  const safeEndpoints = sanitizeEndpointsConfig(network, endpoints);
  const electrums: ElectrumWsTransport[] = [];
  const transports: LightWalletTransport[] = [];

  for (const clean of safeEndpoints.electrumUrls) {
    const ws = new ElectrumWsTransport({ url: clean, network, timeoutMs: 25_000 });
    electrums.push(ws);
    transports.push(ws);
  }

  let explorer: ExplorerRestTransport | null = null;
  if (safeEndpoints.explorerUrl) {
    explorer = new ExplorerRestTransport({ baseUrl: safeEndpoints.explorerUrl, network });
    transports.push(explorer);
  }

  if (transports.length === 0) {
    throw new Error('Configure at least one Electrum WebSocket URL or Explorer API URL');
  }

  const failover = new FailoverTransport(transports);
  return {
    transport: failover,
    electrums,
    explorer,
    close: () => failover.close()
  };
}

export async function checkMultiServerConsensus(
  electrumUrls: ReadonlyArray<string>,
  network: NetworkId
): Promise<TipConsensusReport> {
  const cleanUrls = electrumUrls
    .map((u) => u.trim())
    .filter(Boolean)
    .map((u) => validateElectrumUrl(u, network));
  if (cleanUrls.length === 0) {
    return evaluateTipConsensus([]);
  }
  const clients = cleanUrls.map((url) => new ElectrumWsTransport({ url, network, timeoutMs: 7000 }));
  try {
    const settled = await Promise.allSettled(clients.map((c) => c.getTip()));
    const tips: ServerTip[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') tips.push(res.value);
    }
    return evaluateTipConsensus(tips, 2);
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
  }
}

export interface WalletSyncSnapshot {
  readonly tip: ServerTip;
  readonly fees: FeeEstimate;
  readonly spendableSatoshis: bigint;
  readonly lockedSatoshis: bigint;
  readonly immatureSatoshis: bigint;
  readonly confirmedSatoshis: bigint;
  readonly unconfirmedSatoshis: bigint;
  readonly utxos: Utxo[];
  readonly history: AddressHistoryItem[];
  readonly syncedAt: string;
}

export async function syncWalletState(
  transport: LightWalletTransport,
  addresses: ReadonlyArray<string>,
  network: NetworkId
): Promise<WalletSyncSnapshot> {
  const uniqueAddrs = [...new Set(addresses.filter(Boolean))];
  const [tip, fees] = await Promise.all([transport.getTip(), transport.estimateFee()]);

  const perAddressResults = await Promise.all(
    uniqueAddrs.map(async (addr) => {
      const [bal, utxos, history] = await Promise.all([
        transport.getBalance(addr),
        transport.listUnspent(addr),
        transport.getHistory(addr)
      ]);
      return { bal, utxos, history };
    })
  );

  // Deduplicate UTXOs by outpoint (`txid:vout`) across queried addresses
  const utxoMap = new Map<string, Utxo>();
  let unconfirmedDelta = 0n;
  for (const res of perAddressResults) {
    unconfirmedDelta += res.bal.unconfirmedSatoshis;
    for (const u of res.utxos) {
      utxoMap.set(`${u.txid}:${u.vout}`, u);
    }
  }

  const allUtxos = [...utxoMap.values()].sort((a, b) => {
    const ha = a.blockHeight ?? Number.MAX_SAFE_INTEGER;
    const hb = b.blockHeight ?? Number.MAX_SAFE_INTEGER;
    if (ha !== hb) return hb - ha;
    return a.txid.localeCompare(b.txid);
  });

  const confirmedUtxos = allUtxos.filter((u) => (u.confirmations ?? 0) > 0);
  const parts = partitionUtxos(confirmedUtxos, tip.height, network);
  const sum = (list: ReadonlyArray<Utxo>) => list.reduce((acc, u) => acc + u.satoshis, 0n);

  const spendableSatoshis = sum(parts.spendable);
  const lockedSatoshis = sum(parts.locked);
  const immatureSatoshis = sum(parts.immature);
  const confirmedSatoshis = spendableSatoshis + lockedSatoshis + immatureSatoshis;

  // Merge history per txid (keep highest confirmation count / latest entry)
  const historyMap = new Map<string, AddressHistoryItem>();
  for (const res of perAddressResults) {
    for (const item of res.history) {
      if (!historyMap.has(item.txid)) {
        historyMap.set(item.txid, item);
      }
    }
  }
  const history = [...historyMap.values()].sort((a, b) => {
    const ha = a.height ?? Number.MAX_SAFE_INTEGER;
    const hb = b.height ?? Number.MAX_SAFE_INTEGER;
    if (ha !== hb) return hb - ha;
    return a.txid.localeCompare(b.txid);
  });

  return {
    tip,
    fees,
    spendableSatoshis,
    lockedSatoshis,
    immatureSatoshis,
    confirmedSatoshis,
    unconfirmedSatoshis: unconfirmedDelta,
    utxos: allUtxos,
    history,
    syncedAt: new Date().toISOString()
  };
}

export function attachSignableKeysToUtxos(
  utxos: ReadonlyArray<Utxo>,
  session: UnlockedWalletSession,
  receiveCount: number,
  taprootCount: number
): SignableUtxo[] {
  const keys = session.getSignableKeyMap(receiveCount, taprootCount);
  const byPkh = new Map<string, SignableKeyEntry>();
  const byScript = new Map<string, SignableKeyEntry>();
  const byAddr = new Map<string, SignableKeyEntry>();

  for (const k of keys) {
    byScript.set(k.scriptHex, k);
    byAddr.set(k.address, k);
    if (k.pubkeyHashHex) byPkh.set(k.pubkeyHashHex, k);
  }

  const resolved: SignableUtxo[] = [];
  for (const u of utxos) {
    const classified = classifyScriptPubKey(u.scriptPubKey);
    let keyEntry: SignableKeyEntry | undefined;

    if (
      (classified.type === 'pubkeyhash' ||
        classified.type === 'cltv_timelock' ||
        classified.type === 'adam_coinlock' ||
        classified.type === 'adam_powlock') &&
      classified.hash
    ) {
      keyEntry = byPkh.get(bytesToHex(classified.hash));
    } else if (classified.type === 'witness_v1_taproot') {
      keyEntry = byScript.get(bytesToHex(u.scriptPubKey));
    }

    if (!keyEntry && u.address) {
      keyEntry = byAddr.get(u.address);
    }

    if (keyEntry) {
      resolved.push({
        ...u,
        privateKey: keyEntry.privateKey,
        isTweakedKey: keyEntry.isTaproot ? false : undefined
      });
    }
  }
  return resolved;
}

export function parseRecipientOrUri(
  rawInput: string,
  network: NetworkId
): {
  address: string;
  amountFromUri?: string;
  label?: string;
  decoded: ReturnType<typeof decodeAddress>;
} {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('Recipient address is required');
  }
  const parsed = parseIncomingMobileLink(trimmed, network);
  if (parsed.kind === 'invalid') {
    throw new Error(parsed.reason);
  }
  return {
    address: parsed.address,
    amountFromUri: parsed.amountKrista,
    label: parsed.label,
    decoded: parsed.decoded
  };
}

export function prepareAndSignSend(params: {
  network: NetworkId;
  session: UnlockedWalletSession;
  utxos: ReadonlyArray<Utxo>;
  recipientInput: string;
  amountStr?: string;
  subtractFee?: boolean;
  feeRatePerKb?: bigint;
  changeAddress: string;
  currentHeight: number;
  opReturnMemo?: string;
  lockHeight?: number;
  receiveCount: number;
  taprootCount: number;
}): {
  signed: SignedTransaction;
  destinationAddress: string;
  opReturn1000xWarning: boolean;
  polLockHeight: number | null;
} {
  const parsed = parseRecipientOrUri(params.recipientInput, params.network);
  const amountText = (params.amountStr?.trim() || parsed.amountFromUri || '').trim();
  if (!amountText) {
    throw new Error('Send amount is required');
  }
  const amountSats = kristaToSatoshis(amountText);
  if (amountSats <= 0n) {
    throw new Error('Send amount must be greater than 0');
  }

  if (params.lockHeight !== undefined) {
    if (!Number.isInteger(params.lockHeight) || params.lockHeight <= params.currentHeight) {
      throw new Error(
        `PoL lock height must be an integer greater than current height (${params.currentHeight})`
      );
    }
  }

  const dest: TransactionDestination =
    params.lockHeight !== undefined
      ? (() => {
          if (parsed.decoded.type !== 'p2pkh') {
            throw new Error('PoL timelock destination must be a P2PKH (KT... / kt...) address');
          }
          return {
            scriptPubKey: buildCltvTimelockScript(params.lockHeight!, parsed.decoded.hash),
            satoshis: amountSats
          };
        })()
      : {
          address: parsed.address,
          satoshis: amountSats
        };

  const opReturnMemoClean = params.opReturnMemo?.trim();
  const opReturnData = opReturnMemoClean ? utf8ToBytes(opReturnMemoClean) : undefined;
  const signableUtxos = attachSignableKeysToUtxos(
    params.utxos,
    params.session,
    params.receiveCount,
    params.taprootCount
  );

  const signed = buildAndSignTransaction({
    network: params.network,
    utxos: signableUtxos,
    destinations: [dest],
    changeAddress: params.changeAddress,
    currentHeight: params.currentHeight,
    opReturnData,
    feeRatePerKb: params.feeRatePerKb,
    subtractFeeFromOutputIndex: params.subtractFee ? 0 : undefined
  });

  return {
    signed,
    destinationAddress: parsed.address,
    opReturn1000xWarning: Boolean(opReturnData),
    polLockHeight:
      params.lockHeight !== undefined && params.lockHeight > params.currentHeight
        ? params.lockHeight
        : null
  };
}

export async function verifySelectedInputsOnline(
  bundle: WalletTransportBundle,
  inputs: ReadonlyArray<TxInput>,
  utxos: ReadonlyArray<Utxo>
): Promise<void> {
  const rawCache = new Map<string, string>();
  for (const inp of inputs) {
    const matched = utxos.find((u) => u.txid === inp.txid && u.vout === inp.vout);
    if (!matched) continue;
    let rawHex = rawCache.get(inp.txid);
    if (rawHex === undefined) {
      rawHex = await bundle.transport.getRawTransaction(inp.txid).catch(() => '');
      rawCache.set(inp.txid, rawHex);
    }
    if (rawHex) {
      verifyUtxoAgainstRawTx(matched, rawHex);
    }
  }
}

export async function verifyTransactionSpv(
  bundle: WalletTransportBundle,
  txid: string
): Promise<{
  verified: boolean;
  blockHeight: number;
  merkleroot: string;
  pos: number;
  crossChecked?: boolean;
  error?: string;
}> {
  try {
    const [proof, rawTxHex] = await Promise.all([
      bundle.transport.getMerkleProof(txid),
      bundle.transport.getRawTransaction(txid).catch(() => undefined)
    ]);

    const electrumSettled = await Promise.allSettled(
      bundle.electrums.map((electrum) =>
        electrum.call<{ merkleroot: string }>('krista.block.header_info', [proof.blockHeight])
      )
    );
    const electrumRoots: string[] = [];
    for (const res of electrumSettled) {
      if (res.status === 'fulfilled' && res.value?.merkleroot) {
        const clean = res.value.merkleroot.trim().toLowerCase();
        if (clean) electrumRoots.push(clean);
      }
    }

    const allRoots = new Set<string>(electrumRoots);
    if (proof.merkleRoot?.trim()) {
      allRoots.add(proof.merkleRoot.trim().toLowerCase());
    }

    if (allRoots.size > 1) {
      return {
        verified: false,
        blockHeight: proof.blockHeight,
        merkleroot: '',
        pos: proof.pos,
        crossChecked: false,
        error: 'Conflicting Merkle roots from Electrum servers'
      };
    }

    const merkleroot = [...allRoots][0] ?? '';
    if (!merkleroot) {
      return {
        verified: false,
        blockHeight: proof.blockHeight,
        merkleroot: '',
        pos: proof.pos,
        crossChecked: false,
        error: 'Unable to fetch block Merkle root from Electrum server'
      };
    }

    const ok = verifyMerkleProof(proof, merkleroot, { rawTxHex });
    return {
      verified: ok,
      blockHeight: proof.blockHeight,
      merkleroot,
      pos: proof.pos,
      crossChecked: electrumRoots.length >= 2
    };
  } catch (err) {
    return {
      verified: false,
      blockHeight: 0,
      merkleroot: '',
      pos: 0,
      crossChecked: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export function buildUnsignedPsbtForWallet(params: {
  network: NetworkId;
  utxos: ReadonlyArray<Utxo>;
  recipientInput: string;
  amountStr: string;
  feeRatePerKb?: bigint;
  changeAddress: string;
  currentHeight: number;
  lockHeight?: number;
  rawTxByTxid?: ReadonlyMap<string, Uint8Array>;
}): {
  psbtBase64: string;
  feeSatoshis: bigint;
  changeSatoshis: bigint;
  selectedInputs: number;
} {
  const net = getNetwork(params.network);
  const parsed = parseRecipientOrUri(params.recipientInput, params.network);
  const sendSats = kristaToSatoshis(params.amountStr.trim());
  if (sendSats <= 0n) {
    throw new Error('Send amount must be positive');
  }

  const spendable = partitionUtxos(params.utxos, params.currentHeight, net).spendable;
  if (spendable.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  if (params.lockHeight !== undefined) {
    if (!Number.isInteger(params.lockHeight) || params.lockHeight <= params.currentHeight) {
      throw new Error(
        `PoL lock height must be an integer greater than current height (${params.currentHeight})`
      );
    }
  }

  const destScript =
    params.lockHeight !== undefined
      ? (() => {
          if (parsed.decoded.type !== 'p2pkh') {
            throw new Error('PoL timelock destination must be a P2PKH address');
          }
          return buildCltvTimelockScript(params.lockHeight!, parsed.decoded.hash);
        })()
      : parsed.decoded.scriptPubKey;

  const estFee = estimateMinRelayFee(250, false, net, params.feeRatePerKb);
  const selected = selectUtxosLargestFirst(spendable, sendSats + estFee);
  const inSum = selected.reduce((s, u) => s + u.satoshis, 0n);
  if (inSum < sendSats + estFee) {
    throw new Error(`Insufficient spendable funds (need ${satoshisToKrista(sendSats + estFee)} KRISTA)`);
  }

  const changeScript = addressToScriptPubKey(params.changeAddress, net);
  const destOutBytes = 8 + 1 + destScript.length;
  const changeOutBytes = 8 + 1 + changeScript.length;
  const estFinalBytes = 10 + selected.length * 149 + destOutBytes + changeOutBytes;
  const finalFee = estimateMinRelayFee(estFinalBytes, false, net, params.feeRatePerKb);
  const changeSats = inSum - sendSats - finalFee;
  if (changeSats < 0n) {
    throw new Error('Insufficient funds after exact fee adjustment');
  }

  const outputs = [{ satoshis: sendSats, scriptPubKey: destScript }];
  if (changeSats >= net.dustThreshold) {
    outputs.push({ satoshis: changeSats, scriptPubKey: changeScript });
  }

  let maxLockTime = 0;
  for (const u of selected) {
    if (u.lockHeight && u.lockHeight > maxLockTime) maxLockTime = u.lockHeight;
  }

  const unsignedTx: Transaction = {
    version: 1,
    inputs: selected.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      scriptSig: new Uint8Array(0),
      sequence: maxLockTime > 0 ? 0xfffffffe : 0xffffffff
    })),
    outputs,
    locktime: maxLockTime
  };

  const psbt = createPsbt(
    unsignedTx,
    selected.map((u) => {
      const rawPrev = params.rawTxByTxid?.get(u.txid);
      if (classifyScriptPubKey(u.scriptPubKey).type !== 'witness_v1_taproot' && rawPrev) {
        return { nonWitnessUtxo: rawPrev };
      }
      return {
        witnessUtxo: { satoshis: u.satoshis, scriptPubKey: u.scriptPubKey }
      };
    })
  );

  return {
    psbtBase64: encodePsbtBase64(psbt),
    feeSatoshis: finalFee,
    changeSatoshis: changeSats >= net.dustThreshold ? changeSats : 0n,
    selectedInputs: selected.length
  };
}

export interface PsbtInspectionSummary {
  readonly inputsCount: number;
  readonly signedInputsCount: number;
  readonly finalizedInputsCount: number;
  readonly totalInputSatoshis: bigint | null;
  readonly totalOutputSatoshis: bigint;
  readonly feeSatoshis: bigint | null;
  readonly absurdFeeWarning: boolean;
  readonly locktime: number;
  readonly hasNonAllSighash: boolean;
  readonly unverifiedLegacyInputsCount: number;
  readonly hasOpReturn: boolean;
  readonly outputs: PsbtDetailedOutputSummary[];
  readonly hasAllInputsReady: boolean;
}

export function inspectPsbtBase64(
  b64: string,
  network: NetworkId = 'mainnet',
  ownAddresses: ReadonlyArray<string> = []
): PsbtInspectionSummary {
  const s = inspectPsbtSummary(b64.trim(), network, ownAddresses);
  return {
    inputsCount: s.inputsCount,
    signedInputsCount: s.signedInputsCount,
    finalizedInputsCount: s.finalizedInputsCount,
    totalInputSatoshis: s.totalInputSatoshis,
    totalOutputSatoshis: s.totalOutputSatoshis,
    feeSatoshis: s.feeSatoshis,
    absurdFeeWarning: s.absurdFeeWarning,
    locktime: s.locktime,
    hasNonAllSighash: s.hasNonAllSighash,
    unverifiedLegacyInputsCount: s.unverifiedLegacyInputsCount,
    hasOpReturn: s.hasOpReturn,
    outputs: s.outputs,
    hasAllInputsReady: s.hasAllInputsReady
  };
}

export function signAndFinalizePsbtWithSession(
  b64: string,
  session: UnlockedWalletSession,
  receiveCount: number,
  taprootCount: number
): {
  psbtBase64: string;
  signedCount: number;
  finalized: boolean;
  rawHex?: string;
  txid?: string;
} {
  const psbt = decodePsbt(b64.trim());
  const keys = session.getSignableKeyMap(receiveCount, taprootCount);
  const byPkh = new Map<string, SignableKeyEntry>();
  const byScript = new Map<string, SignableKeyEntry>();
  for (const k of keys) {
    byScript.set(k.scriptHex, k);
    if (k.pubkeyHashHex) byPkh.set(k.pubkeyHashHex, k);
  }

  let signedCount = 0;
  for (let i = 0; i < psbt.inputs.length; i++) {
    const utxo = getPsbtInputUtxo(psbt, i);
    const classified = classifyScriptPubKey(utxo.scriptPubKey);
    let keyEntry: SignableKeyEntry | undefined;
    if (
      (classified.type === 'pubkeyhash' ||
        classified.type === 'cltv_timelock' ||
        classified.type === 'adam_coinlock' ||
        classified.type === 'adam_powlock') &&
      classified.hash
    ) {
      keyEntry = byPkh.get(bytesToHex(classified.hash));
    } else if (classified.type === 'witness_v1_taproot') {
      keyEntry = byScript.get(bytesToHex(utxo.scriptPubKey));
    }

    if (keyEntry) {
      signPsbtInput(
        psbt,
        i,
        keyEntry.privateKey,
        keyEntry.isTaproot ? { isTweakedKey: false } : undefined
      );
      signedCount++;
    }
  }

  const finalized = finalizePsbt(psbt);
  let rawHex: string | undefined;
  let txid: string | undefined;
  if (finalized) {
    const finalTx = extractTransactionFromPsbt(psbt);
    const raw = serializeTransaction(finalTx);
    rawHex = bytesToHex(raw);
    txid = getTxid(raw);
  }

  return {
    psbtBase64: encodePsbtBase64(psbt),
    signedCount,
    finalized,
    rawHex,
    txid
  };
}

export {
  formatPaymentUri,
  sanitizeExplorerBrowserUrl,
  satoshisToKrista,
  type SignedTransaction,
  type TipConsensusReport
};
