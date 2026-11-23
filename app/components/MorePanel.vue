<script setup lang="ts">
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Coins,
  Cpu,
  Download,
  Eye,
  EyeOff,
  FileSignature,
  Globe,
  KeyRound,
  Lock,
  Monitor,
  Moon,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Wrench
} from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  bip38Decrypt,
  bip38Encrypt,
  getSimpleScriptLabel,
  partitionUtxos,
  satoshisToKrista,
  signMessage,
  verifyMessage,
  type NetworkId
} from '@kristatech/sdk';
import ConfirmActionDialog from '~/components/ConfirmActionDialog.vue';
import CopyButton from '~/components/CopyButton.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { usePwaInstall } from '~/composables/usePwaInstall';
import { useTheme, type ThemePreference } from '~/composables/useTheme';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { formatCompactKrista } from '~/utils/formatBalance';
import { isValidMobilePin, isWeakMobilePin } from '~/utils/mobileVault';
import {
  buildUnsignedPsbtForWallet,
  inspectPsbtBase64,
  signAndFinalizePsbtWithSession,
  type PsbtInspectionSummary
} from '~/utils/walletCore';

const store = useMobileWalletStore();
const { t, locale, languages, setLocale } = useWalletI18n();
const { preference, resolvedTheme, setPreference } = useTheme();
const { canInstall, installing, installStatus, triggerInstall } = usePwaInstall();

const confirmDialogRef = ref<InstanceType<typeof ConfirmActionDialog> | null>(null);
const section = ref<'activity' | 'tools' | 'security' | 'settings'>('activity');

// Activity tab state
const actSubTab = ref<'txs' | 'utxos'>('txs');
const verifyingTxid = ref<string | null>(null);
const history = computed(() => store.snapshot.value?.history ?? []);
const utxos = computed(() => store.snapshot.value?.utxos ?? []);
const tipHeight = computed(() => store.snapshot.value?.tip.height ?? 0);

const lockedOutpointSet = computed(() => {
  if (!store.snapshot.value) return new Set<string>();
  const parts = partitionUtxos(utxos.value, tipHeight.value, store.currentNetwork.value);
  return new Set(parts.locked.map((u) => `${u.txid}:${u.vout}`));
});

const immatureOutpointSet = computed(() => {
  if (!store.snapshot.value) return new Set<string>();
  const parts = partitionUtxos(utxos.value, tipHeight.value, store.currentNetwork.value);
  return new Set(parts.immature.map((u) => `${u.txid}:${u.vout}`));
});

// Tools state (PSBT + Sign/Verify + BIP38)
const psbtTo = ref('');
const psbtAmount = ref('');
const psbtPayload = ref('');
const psbtInfo = ref<PsbtInspectionSummary | null>(null);
const psbtFinalHex = ref('');
const psbtOutputMsg = ref('');

const msgText = ref('');
const msgSig = ref('');
const msgAddr = ref('');
const msgCheckStatus = ref('');

const bip38Input = ref('');
const bip38Pass = ref('');
const bip38Output = ref('');

// Security & Quick PIN state
const pinVaultPass = ref('');
const newPin = ref('');
const confirmPin = ref('');
const pinMsg = ref('');
const pinErr = ref('');
const seedCheckPass = ref('');
const revealedSeed = ref('');
const seedErr = ref('');
let seedAutoHideTimer: ReturnType<typeof setTimeout> | null = null;

// Settings state
const networkInput = ref<NetworkId>(store.currentNetwork.value);
const electrumText = ref(store.currentEndpoints.value.electrumUrls.join('\n'));
const explorerInput = ref(store.currentEndpoints.value.explorerUrl ?? '');
const autoLockInput = ref(store.autoLockMins.value);
const endpointStatus = ref('');
const endpointErr = ref(false);

function clearSeedAutoHideTimer() {
  if (seedAutoHideTimer) {
    clearTimeout(seedAutoHideTimer);
    seedAutoHideTimer = null;
  }
}

function hideRevealedSeed() {
  clearSeedAutoHideTimer();
  revealedSeed.value = '';
  seedCheckPass.value = '';
}

function clearSensitiveSectionFields() {
  hideRevealedSeed();
  seedErr.value = '';
  pinVaultPass.value = '';
  newPin.value = '';
  confirmPin.value = '';
  bip38Pass.value = '';
}

const onVisibilityChange = () => {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    clearSensitiveSectionFields();
  }
};

watch(section, () => {
  clearSensitiveSectionFields();
});

onMounted(() => {
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange);
  }
});

onBeforeUnmount(() => {
  clearSensitiveSectionFields();
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  }
});

watch(
  () => store.activeProfile.value,
  (prof) => {
    if (!prof) return;
    networkInput.value = prof.network;
    electrumText.value = prof.endpoints.electrumUrls.join('\n');
    explorerInput.value = prof.endpoints.explorerUrl ?? '';
  }
);

async function handleVerifySpv(txid: string) {
  if (verifyingTxid.value) return;
  verifyingTxid.value = txid;
  try {
    await store.verifyTxSpv(txid);
  } finally {
    verifyingTxid.value = null;
  }
}

function buildUnsignedPsbt() {
  psbtOutputMsg.value = '';
  const prof = store.activeProfile.value;
  const snap = store.snapshot.value;
  if (!prof || !snap) {
    psbtOutputMsg.value = t('offlineBanner');
    return;
  }
  try {
    const res = buildUnsignedPsbtForWallet({
      network: prof.network,
      utxos: snap.utxos,
      recipientInput: psbtTo.value,
      amountStr: psbtAmount.value,
      changeAddress: store.trackedAddresses.value.p2pkh[0]!,
      currentHeight: snap.tip.height
    });
    psbtPayload.value = res.psbtBase64;
    psbtFinalHex.value = '';
    psbtInfo.value = inspectPsbtBase64(
      res.psbtBase64,
      store.currentNetwork.value,
      store.trackedAddresses.value.all
    );
  } catch (err) {
    psbtOutputMsg.value = err instanceof Error ? err.message : String(err);
  }
}

function inspectPsbt() {
  psbtOutputMsg.value = '';
  try {
    psbtInfo.value = inspectPsbtBase64(
      psbtPayload.value,
      store.currentNetwork.value,
      store.trackedAddresses.value.all
    );
  } catch (err) {
    psbtOutputMsg.value = err instanceof Error ? err.message : String(err);
  }
}

function signPsbt() {
  psbtOutputMsg.value = '';
  const sess = store.session.value;
  const prof = store.activeProfile.value;
  if (!sess || !prof) return;
  try {
    const res = signAndFinalizePsbtWithSession(
      psbtPayload.value,
      sess,
      prof.receiveCount,
      prof.taprootCount
    );
    psbtPayload.value = res.psbtBase64;
    psbtInfo.value = inspectPsbtBase64(
      res.psbtBase64,
      store.currentNetwork.value,
      store.trackedAddresses.value.all
    );
    psbtFinalHex.value = res.rawHex ?? '';
    psbtOutputMsg.value = res.txid ? `TXID: ${res.txid}` : `Signed inputs: ${res.signedCount}`;
  } catch (err) {
    psbtOutputMsg.value = err instanceof Error ? err.message : String(err);
  }
}

async function broadcastPsbt() {
  if (!psbtFinalHex.value) return;
  try {
    const txid = await store.broadcastRawTx(psbtFinalHex.value);
    psbtOutputMsg.value = t('txBroadcastSuccess', { txid });
    psbtFinalHex.value = '';
  } catch (err) {
    psbtOutputMsg.value = err instanceof Error ? err.message : String(err);
  }
}

function signMsg() {
  msgCheckStatus.value = '';
  const sess = store.session.value;
  if (!sess) return;
  try {
    const k = sess.deriveP2pkh(0);
    msgAddr.value = k.address;
    msgSig.value = signMessage(msgText.value, k.privateKey, true, store.currentNetwork.value);
  } catch (err) {
    msgCheckStatus.value = err instanceof Error ? err.message : String(err);
  }
}

function verifyMsg() {
  try {
    const ok = verifyMessage(msgText.value, msgSig.value.trim(), msgAddr.value.trim(), store.currentNetwork.value);
    msgCheckStatus.value = ok ? '✓ Valid' : '✗ Invalid';
  } catch (err) {
    msgCheckStatus.value = err instanceof Error ? err.message : String(err);
  }
}

function runBip38Encrypt() {
  const sess = store.session.value;
  if (!sess || !bip38Pass.value) return;
  try {
    const k = sess.deriveP2pkh(0);
    bip38Output.value = bip38Encrypt(k.privateKey, bip38Pass.value, store.currentNetwork.value, true);
  } catch (err) {
    bip38Output.value = err instanceof Error ? err.message : String(err);
  }
}

function runBip38Decrypt() {
  if (!bip38Input.value || !bip38Pass.value) return;
  try {
    const res = bip38Decrypt(bip38Input.value.trim(), bip38Pass.value, store.currentNetwork.value);
    bip38Output.value = res.address;
  } catch (err) {
    bip38Output.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleEnableQuickPin() {
  pinMsg.value = '';
  pinErr.value = '';
  if (!isValidMobilePin(newPin.value)) {
    pinErr.value = t('pinInvalidFormat');
    return;
  }
  if (isWeakMobilePin(newPin.value)) {
    pinErr.value = 'Choose a stronger 6-digit PIN (avoid repeated or sequential digits)';
    return;
  }
  if (newPin.value !== confirmPin.value) {
    pinErr.value = t('pinConfirmMismatch');
    return;
  }
  try {
    await store.enableQuickPin(pinVaultPass.value, newPin.value);
    pinVaultPass.value = '';
    newPin.value = '';
    confirmPin.value = '';
    pinMsg.value = t('pinEnabledStatus');
  } catch (err) {
    pinErr.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleDisableQuickPin() {
  await store.disableQuickPin();
  pinMsg.value = t('pinDisabledStatus');
}

async function handleRevealSeed() {
  seedErr.value = '';
  hideRevealedSeed();
  try {
    const phrase = await store.revealRecoverySeedWithPassword(seedCheckPass.value);
    seedCheckPass.value = '';
    revealedSeed.value = phrase;
    seedAutoHideTimer = setTimeout(() => {
      hideRevealedSeed();
    }, 60_000);
  } catch (err) {
    seedErr.value = err instanceof Error ? err.message : String(err);
  }
}

function handleExportBackup() {
  pinErr.value = '';
  const prof = store.activeProfile.value;
  if (!prof || typeof document === 'undefined') return;
  try {
    const json = store.exportEncryptedBackup();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `krista-mobile-backup-${prof.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    pinErr.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleSaveEndpoints() {
  endpointStatus.value = '';
  endpointErr.value = false;
  try {
    const urls = electrumText.value
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean);
    await store.updateEndpointsAndNetwork(networkInput.value, urls, explorerInput.value.trim());
    await store.setAutoLockMinutes(autoLockInput.value);
    endpointStatus.value = t('syncedLabel');
  } catch (err) {
    endpointErr.value = true;
    endpointStatus.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleTestConsensus() {
  endpointStatus.value = '';
  endpointErr.value = false;
  try {
    const rep = await store.checkConsensus();
    endpointStatus.value = rep.agreed
      ? t('consensusOk', { count: rep.matchingServers.length, height: rep.majorityHeight ?? 0 })
      : t('consensusWarn', { height: rep.majorityHeight ?? 0 });
  } catch (err) {
    endpointErr.value = true;
    endpointStatus.value = err instanceof Error ? err.message : String(err);
  }
}

async function handleWipeWallet() {
  const confirmed = await confirmDialogRef.value?.ask({
    title: t('confirmWipeTitle'),
    description: t('wipeDialogDesc'),
    confirmLabel: t('wipeConfirmBtn'),
    destructive: true
  });
  if (confirmed) {
    await store.wipeActiveProfile();
  }
}

const hubTabs = computed(() => [
  { id: 'activity' as const, label: t('moreActivity'), icon: Activity },
  { id: 'tools' as const, label: t('moreTools'), icon: Wrench },
  { id: 'security' as const, label: t('moreSecurity'), icon: Shield },
  { id: 'settings' as const, label: t('moreSettings'), icon: Settings }
]);
</script>

<template>
  <div class="space-y-4">
    <!-- Single-Row 4-Icon Hub Bar -->
    <div class="card-surface px-2 pt-1">
      <div class="tab-strip border-b-0" role="tablist" aria-label="More wallet sections">
        <button
          v-for="tab in hubTabs"
          :id="`more-hub-tab-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          class="tab-strip-btn flex-1"
          :aria-selected="section === tab.id"
          @click="section = tab.id"
        >
          <component :is="tab.icon" class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{{ tab.label }}</span>
        </button>
      </div>
    </div>

    <!-- 1. Activity & SPV Proof + UTXOs -->
    <section
      v-if="section === 'activity'"
      role="tabpanel"
      aria-labelledby="more-hub-tab-activity"
      class="card-surface p-4 sm:p-5 space-y-3.5"
    >
      <div class="tab-strip" role="tablist" aria-label="Activity sub-tabs">
        <button
          id="more-act-tab-txs"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="actSubTab === 'txs'"
          @click="actSubTab = 'txs'"
        >
          <Activity class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('historyTab') }} ({{ history.length }})</span>
        </button>
        <button
          id="more-act-tab-utxos"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="actSubTab === 'utxos'"
          @click="actSubTab = 'utxos'"
        >
          <Coins class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{{ t('utxosTab') }} ({{ utxos.length }})</span>
        </button>
      </div>

      <!-- Transactions List -->
      <div
        v-if="actSubTab === 'txs'"
        role="tabpanel"
        aria-labelledby="more-act-tab-txs"
        class="space-y-2.5"
      >
        <p v-if="!history.length" class="py-6 text-center text-xs text-(--text-muted)">
          {{ t('noHistoryYet') }}
        </p>
        <div
          v-for="item in history"
          :key="item.txid"
          class="card-subtle p-3.5 space-y-2.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-start gap-2.5 min-w-0">
              <div
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                :class="
                  item.netSatoshis !== undefined
                    ? item.netSatoshis >= 0n
                      ? 'bg-(--status-ok-bg) text-(--status-ok)'
                      : 'bg-coral-400/15 text-(--accent-coral)'
                    : 'bg-cobalt-400/15 text-(--accent)'
                "
              >
                <ArrowDownLeft
                  v-if="item.netSatoshis !== undefined && item.netSatoshis >= 0n"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                <ArrowUpRight
                  v-else-if="item.netSatoshis !== undefined && item.netSatoshis < 0n"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                <Activity v-else class="h-4 w-4" aria-hidden="true" />
              </div>
              <code class="font-mono text-[11px] font-bold break-all text-(--text-main)">
                {{ item.txid }}
              </code>
            </div>

            <span class="shrink-0 rounded-md bg-(--surface-elevated) px-2 py-0.5 font-mono text-[11px] font-semibold text-(--text-muted)">
              {{ (item.height ?? 0) > 0 ? `#${item.height}` : t('unconfirmedLabel') }}
            </span>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span
                v-if="store.spvResults.value[item.txid]?.verified"
                class="inline-flex items-center gap-1 rounded-full bg-(--status-ok-bg) px-2.5 py-0.5 font-mono text-[11px] font-bold text-(--status-ok)"
              >
                <ShieldCheck class="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {{ t('spvVerified') }} (pos {{ store.spvResults.value[item.txid]?.pos }}{{
                    store.spvResults.value[item.txid]?.crossChecked ? ' · 2+ servers' : ' · 1 server'
                  }})
                </span>
              </span>
              <span
                v-else-if="store.spvResults.value[item.txid] && !store.spvResults.value[item.txid]?.verified"
                class="inline-flex items-center gap-1 rounded-full bg-(--status-danger-bg) px-2.5 py-0.5 font-mono text-[11px] font-bold text-(--status-danger)"
              >
                <AlertTriangle class="h-3.5 w-3.5" aria-hidden="true" />
                <span>{{ t('spvFailed') }}</span>
              </span>
              <button
                v-else-if="(item.height ?? 0) > 0"
                type="button"
                :disabled="verifyingTxid === item.txid"
                class="btn-secondary !rounded-full !px-3 !py-1 text-[11px] text-(--accent)"
                @click="handleVerifySpv(item.txid)"
              >
                <Shield class="h-3 w-3" aria-hidden="true" />
                <span>{{ t('verifySpvBtn') }}</span>
              </button>
            </div>

            <span
              v-if="item.netSatoshis !== undefined"
              class="font-mono text-xs font-bold tabular-nums"
              :class="item.netSatoshis >= 0n ? 'text-(--status-ok)' : 'text-(--accent-coral)'"
            >
              {{ item.netSatoshis >= 0n ? '+' : '' }}{{ formatCompactKrista(satoshisToKrista(item.netSatoshis)) }} KRISTA
            </span>
          </div>
        </div>
      </div>

      <!-- UTXO Coin Control Cards -->
      <div
        v-else
        role="tabpanel"
        aria-labelledby="more-act-tab-utxos"
        class="space-y-2.5"
      >
        <p v-if="!utxos.length" class="py-6 text-center text-xs text-(--text-muted)">
          {{ t('noUtxosYet') }}
        </p>
        <div
          v-for="u in utxos"
          :key="`${u.txid}:${u.vout}`"
          class="card-subtle p-3.5 space-y-1.5"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Coins class="h-4 w-4 text-(--accent)" aria-hidden="true" />
              <span class="font-mono text-sm font-bold tabular-nums">
                {{ satoshisToKrista(u.satoshis) }} KRISTA
              </span>
            </div>
            <span
              v-if="lockedOutpointSet.has(`${u.txid}:${u.vout}`)"
              class="inline-flex items-center gap-1 rounded-full bg-(--status-warn-bg) px-2.5 py-0.5 text-[11px] font-bold text-(--status-warn)"
            >
              <Lock class="h-3 w-3" aria-hidden="true" />
              <span>{{ t('statusLockedUntil', { h: u.lockHeight ?? tipHeight }) }}</span>
            </span>
            <span
              v-else-if="immatureOutpointSet.has(`${u.txid}:${u.vout}`)"
              class="inline-flex items-center gap-1 rounded-full bg-(--surface-elevated) px-2.5 py-0.5 text-[11px] font-bold text-(--text-secondary)"
            >
              <Clock class="h-3 w-3" aria-hidden="true" />
              <span>{{ t('statusImmature') }}</span>
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1 rounded-full bg-(--status-ok-bg) px-2.5 py-0.5 text-[11px] font-bold text-(--status-ok)"
            >
              <CheckCircle2 class="h-3 w-3" aria-hidden="true" />
              <span>{{ t('statusSpendable') }}</span>
            </span>
          </div>
          <p class="font-mono text-[11px] text-(--text-muted) break-all">
            {{ u.txid }}:{{ u.vout }} · {{ getSimpleScriptLabel(u.scriptType ?? 'unknown', locale) }}
          </p>
        </div>
      </div>
    </section>

    <!-- 2. PSBT, Message Sign & BIP38 Tools -->
    <section
      v-if="section === 'tools'"
      role="tabpanel"
      aria-labelledby="more-hub-tab-tools"
      class="space-y-4"
    >
      <!-- PSBT -->
      <div class="card-surface p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <Cpu class="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h3 class="text-sm font-bold">{{ t('psbtTitle') }}</h3>
            <p class="text-[11px] text-(--text-muted)">{{ t('psbtBuildTitle') }}</p>
          </div>
        </div>

        <div class="wallet-grid-2">
          <input
            v-model="psbtTo"
            type="text"
            class="wallet-input font-mono text-xs"
            :placeholder="t('confirmDestLabel')"
          />
          <input
            v-model="psbtAmount"
            type="text"
            class="wallet-input font-mono text-xs"
            :placeholder="t('amountLabel')"
          />
        </div>
        <button type="button" class="btn-secondary text-xs" @click="buildUnsignedPsbt">
          {{ t('psbtBuildTitle') }}
        </button>

        <textarea
          v-model="psbtPayload"
          rows="3"
          class="wallet-input font-mono text-xs"
          :placeholder="t('psbtBase64Label')"
        />
        <div class="toolbar">
          <button type="button" class="btn-secondary !py-1.5 text-xs" @click="inspectPsbt">
            {{ t('psbtInspectBtn') }}
          </button>
          <button
            v-if="!store.isWatchOnly.value"
            type="button"
            class="btn-primary !py-1.5 text-xs"
            @click="signPsbt"
          >
            {{ t('psbtSignFinalizeBtn') }}
          </button>
          <button
            v-if="psbtFinalHex"
            type="button"
            class="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
            @click="broadcastPsbt"
          >
            {{ t('psbtBroadcastBtn') }}
          </button>
        </div>

        <div v-if="psbtInfo" class="space-y-2.5">
          <div class="grid grid-cols-3 gap-2">
            <div class="card-subtle px-3 py-2 text-center">
              <span class="block text-[10px] uppercase text-(--text-muted)">Inputs</span>
              <span class="font-mono text-xs font-bold">{{ psbtInfo.inputsCount }}</span>
            </div>
            <div class="card-subtle px-3 py-2 text-center">
              <span class="block text-[10px] uppercase text-(--text-muted)">Signed</span>
              <span class="font-mono text-xs font-bold text-(--accent)">
                {{ psbtInfo.signedInputsCount }}
              </span>
            </div>
            <div class="card-subtle px-3 py-2 text-center">
              <span class="block text-[10px] uppercase text-(--text-muted)">Finalized</span>
              <span class="font-mono text-xs font-bold text-(--status-ok)">
                {{ psbtInfo.finalizedInputsCount }}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="card-subtle px-3 py-2">
              <span class="block text-[10px] uppercase text-(--text-muted)">Total Inputs</span>
              <span class="font-mono text-xs font-bold">
                {{
                  psbtInfo.totalInputSatoshis !== null
                    ? `${satoshisToKrista(psbtInfo.totalInputSatoshis)} KRISTA`
                    : 'Unknown'
                }}
              </span>
            </div>
            <div class="card-subtle px-3 py-2">
              <span class="block text-[10px] uppercase text-(--text-muted)">Fee</span>
              <span
                class="font-mono text-xs font-bold"
                :class="psbtInfo.absurdFeeWarning ? 'text-(--status-danger)' : 'text-(--text-main)'"
              >
                {{
                  psbtInfo.feeSatoshis !== null
                    ? `${satoshisToKrista(psbtInfo.feeSatoshis)} KRISTA`
                    : 'Unknown'
                }}
              </span>
            </div>
          </div>

          <p
            v-if="psbtInfo.absurdFeeWarning"
            class="flex items-center gap-1.5 rounded-xl bg-(--status-danger-bg) px-3 py-2 text-[11px] font-bold text-(--status-danger)"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Warning: Abnormally high transaction fee detected.</span>
          </p>
          <p
            v-if="psbtInfo.hasNonAllSighash"
            class="flex items-center gap-1.5 rounded-xl bg-(--status-danger-bg) px-3 py-2 text-[11px] font-bold text-(--status-danger)"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Warning: Non-SIGHASH_ALL flag present on input(s).</span>
          </p>
          <p
            v-if="psbtInfo.unverifiedLegacyInputsCount > 0"
            class="flex items-center gap-1.5 rounded-xl bg-(--status-warn-bg) px-3 py-2 text-[11px] font-semibold text-(--status-warn)"
          >
            <AlertTriangle class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {{ psbtInfo.unverifiedLegacyInputsCount }} legacy input(s) lack full previous tx (nonWitnessUtxo).
            </span>
          </p>

          <div class="card-subtle divide-y divide-(--border-card) px-3 py-2 text-xs">
            <div
              v-for="(out, idx) in psbtInfo.outputs"
              :key="idx"
              class="flex items-center justify-between gap-2 py-1.5"
            >
              <div class="min-w-0">
                <p class="truncate font-mono text-[11px] font-semibold text-(--text-main)">
                  {{ out.address || out.scriptType }}
                </p>
                <span
                  v-if="out.isOwnChange"
                  class="inline-block rounded bg-(--status-ok-bg) px-1.5 py-0.5 text-[10px] font-bold text-(--status-ok)"
                >
                  Own Change
                </span>
              </div>
              <span class="shrink-0 font-mono text-[11px] font-bold tabular-nums">
                {{ out.amountKrista }} KRISTA
              </span>
            </div>
          </div>
        </div>
        <p v-if="psbtOutputMsg" class="text-xs font-semibold text-(--accent) break-all">
          {{ psbtOutputMsg }}
        </p>
      </div>

      <!-- Message Sign & Verify -->
      <div class="card-surface p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-coral-400/15 text-(--accent-coral)">
            <FileSignature class="h-4 w-4" aria-hidden="true" />
          </div>
          <h3 class="text-sm font-bold">{{ t('msgSignTitle') }}</h3>
        </div>
        <input
          v-model="msgAddr"
          type="text"
          class="wallet-input font-mono text-xs"
          :placeholder="t('msgAddrLabel')"
        />
        <textarea
          v-model="msgText"
          rows="2"
          class="wallet-input text-xs"
          :placeholder="t('msgTextLabel')"
        />
        <textarea
          v-model="msgSig"
          rows="2"
          class="wallet-input font-mono text-xs"
          :placeholder="t('msgSigLabel')"
        />
        <div class="toolbar">
          <button
            v-if="!store.isWatchOnly.value"
            type="button"
            class="btn-primary !py-1.5 text-xs"
            @click="signMsg"
          >
            {{ t('signBtn') }}
          </button>
          <button type="button" class="btn-secondary !py-1.5 text-xs" @click="verifyMsg">
            {{ t('verifyBtn') }}
          </button>
        </div>
        <p v-if="msgCheckStatus" class="text-xs font-bold">{{ msgCheckStatus }}</p>
      </div>

      <!-- BIP38 Paper Key -->
      <div class="card-surface p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <KeyRound class="h-4 w-4" aria-hidden="true" />
          </div>
          <h3 class="text-sm font-bold">{{ t('bip38Title') }}</h3>
        </div>
        <input
          v-model="bip38Input"
          type="text"
          class="wallet-input font-mono text-xs"
          placeholder="6P..."
        />
        <input
          v-model="bip38Pass"
          type="password"
          class="wallet-input text-xs"
          :placeholder="t('bip38PassLabel')"
        />
        <div class="toolbar">
          <button
            v-if="!store.isWatchOnly.value"
            type="button"
            class="btn-primary !py-1.5 text-xs"
            @click="runBip38Encrypt"
          >
            {{ t('bip38EncryptBtn') }}
          </button>
          <button type="button" class="btn-secondary !py-1.5 text-xs" @click="runBip38Decrypt">
            {{ t('bip38DecryptBtn') }}
          </button>
        </div>
        <code v-if="bip38Output" class="block card-subtle p-3 font-mono text-xs break-all">
          {{ bip38Output }}
        </code>
      </div>
    </section>

    <!-- 3. Mobile Security, Quick PIN & Vault Backup -->
    <section
      v-if="section === 'security'"
      role="tabpanel"
      aria-labelledby="more-hub-tab-security"
      class="space-y-4"
    >
      <div v-if="!store.isWatchOnly.value" class="card-surface p-4 sm:p-5 space-y-3.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
              <Shield class="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 class="text-sm font-bold">{{ t('quickPinTitle') }}</h3>
          </div>
          <span
            class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            :class="
              store.hasQuickPin.value
                ? 'bg-(--status-ok-bg) text-(--status-ok)'
                : 'bg-(--surface-elevated) text-(--text-muted)'
            "
          >
            <KeyRound class="h-3 w-3" aria-hidden="true" />
            <span>{{ store.hasQuickPin.value ? t('pinEnabledStatus') : t('pinDisabledStatus') }}</span>
          </span>
        </div>

        <p
          v-if="!store.platformInfo.value.native"
          class="flex items-start gap-2 rounded-xl border border-(--status-warn)/30 bg-(--status-warn-bg) p-2.5 text-[11px] leading-snug font-medium text-(--status-warn)"
        >
          <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Web/PWA mode: Quick PIN stores an encrypted envelope in browser storage. Use a strong Vault Password (or the native Android/iOS app) for large balances.
          </span>
        </p>

        <form class="space-y-3" @submit.prevent="handleEnableQuickPin">
          <input
            v-model="pinVaultPass"
            type="password"
            required
            autocomplete="current-password"
            class="wallet-input text-xs"
            :placeholder="t('passwordLabel')"
          />
          <div class="wallet-grid-2">
            <input
              v-model="newPin"
              type="password"
              inputmode="numeric"
              maxlength="6"
              required
              pattern="^\d{6}$"
              class="wallet-input font-mono text-sm"
              :placeholder="t('quickPinSetup')"
            />
            <input
              v-model="confirmPin"
              type="password"
              inputmode="numeric"
              maxlength="6"
              required
              pattern="^\d{6}$"
              class="wallet-input font-mono text-sm"
              :placeholder="t('passwordConfirmLabel')"
            />
          </div>
          <p v-if="pinErr" class="text-xs font-medium text-(--status-danger)">{{ pinErr }}</p>
          <p v-if="pinMsg" class="text-xs font-medium text-(--status-ok)">{{ pinMsg }}</p>
          <div class="toolbar">
            <button type="submit" class="btn-primary !py-2 text-xs">
              <KeyRound class="h-3.5 w-3.5" aria-hidden="true" />
              <span>{{ t('pinSetBtn') }}</span>
            </button>
            <button
              v-if="store.hasQuickPin.value"
              type="button"
              class="btn-secondary !py-2 text-xs"
              @click="handleDisableQuickPin"
            >
              {{ t('pinRemoveBtn') }}
            </button>
          </div>
        </form>
      </div>

      <div class="card-surface p-4 sm:p-5 space-y-3.5">
        <label class="card-subtle flex items-start gap-3 p-3 text-xs font-semibold cursor-pointer">
          <input
            type="checkbox"
            :checked="store.lockOnBackground.value"
            class="mt-0.5 h-5 w-5 shrink-0 rounded"
            @change="store.setLockOnBackgroundPref(($event.target as HTMLInputElement).checked)"
          />
          <span>
            {{ t('lockOnBackground') }}
            <span class="mt-0.5 block text-[11px] font-normal text-(--text-muted)">
              {{ t('autoLockImmediately') }}
            </span>
          </span>
        </label>

        <div class="toolbar pt-0.5">
          <button type="button" class="btn-secondary !py-2 text-xs" @click="handleExportBackup">
            <Download class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
            <span>{{ t('exportVaultBtn') }}</span>
          </button>
          <button type="button" class="btn-danger !py-2 text-xs" @click="handleWipeWallet">
            <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ t('wipeWalletBtn') }}</span>
          </button>
        </div>
      </div>

      <div v-if="store.activeProfile.value?.mode === 'hd'" class="card-surface p-4 sm:p-5 space-y-3">
        <div class="flex items-center gap-2">
          <Eye class="h-4 w-4 text-(--accent)" aria-hidden="true" />
          <h3 class="text-sm font-bold">{{ t('revealSeedBtn') }}</h3>
        </div>
        <form class="flex flex-wrap gap-2 sm:flex-nowrap" @submit.prevent="handleRevealSeed">
          <input
            v-model="seedCheckPass"
            type="password"
            required
            autocomplete="current-password"
            class="wallet-input text-xs"
            :placeholder="t('passwordLabel')"
          />
          <button type="submit" class="btn-primary !py-2 text-xs shrink-0">
            {{ t('revealSeedBtn') }}
          </button>
        </form>
        <p v-if="seedErr" class="text-xs font-medium text-(--status-danger)">{{ seedErr }}</p>
        <div v-if="revealedSeed" class="space-y-2.5">
          <code id="mob-seed-reveal" class="block card-subtle p-3.5 font-mono text-xs break-words">
            {{ revealedSeed }}
          </code>
          <div class="flex flex-wrap items-center gap-2">
            <CopyButton
              target-id="mob-seed-reveal"
              :label="t('copyBtn')"
              :copied-label="t('copiedMsg')"
              :failed-label="t('copyFailedMsg')"
              sensitive
            />
            <button
              type="button"
              class="btn-secondary !py-1.5 text-xs"
              @click="hideRevealedSeed"
            >
              <EyeOff class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
              <span>{{ t('closeBtn') }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. Language (17), Theme (3-state), Network & Conditional PWA Install -->
    <section
      v-if="section === 'settings'"
      role="tabpanel"
      aria-labelledby="more-hub-tab-settings"
      class="card-surface p-4 sm:p-5 space-y-4"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <Settings class="h-4 w-4" aria-hidden="true" />
          </div>
          <h3 class="text-sm font-bold">{{ t('navSettings') }}</h3>
        </div>
        <span class="rounded-full border border-(--border-card) bg-(--surface-elevated) px-2.5 py-0.5 font-mono text-[11px] font-bold text-(--accent)">
          {{ t('nativeRuntimeBadge', { platform: store.platformInfo.value.platform }) }}
        </span>
      </div>

      <!-- Conditional PWA Install Banner (hidden on native Capacitor and unsupported browsers) -->
      <div
        v-if="canInstall || installStatus"
        class="rounded-2xl border border-(--border-strong) bg-cobalt-400/10 p-3.5 space-y-2.5"
      >
        <button
          v-if="canInstall"
          type="button"
          :aria-disabled="installing ? 'true' : undefined"
          class="btn-primary w-full text-xs"
          @click="triggerInstall"
        >
          <Sparkles class="h-4 w-4" aria-hidden="true" />
          <span>{{ t('installPwaBtn') }}</span>
        </button>
        <p v-if="installStatus" role="status" class="text-xs font-semibold text-(--accent)">
          {{ installStatus }}
        </p>
      </div>

      <!-- 17-Language Selector -->
      <div>
        <label for="mob-lang-select" class="flex items-center gap-1.5 text-xs font-bold mb-1.5">
          <Globe class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
          <span>{{ t('languageLabel') }}</span>
        </label>
        <select
          id="mob-lang-select"
          :value="locale"
          class="wallet-input text-sm"
          @change="setLocale(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="lang in languages" :key="lang.code" :value="lang.code">
            {{ lang.nativeName }} ({{ lang.code }})
          </option>
        </select>
      </div>

      <!-- 3-State Theme Selector -->
      <div>
        <span class="block text-xs font-bold mb-2">{{ t('appearanceLabel') }}</span>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="mode in (['system', 'light', 'dark'] as ThemePreference[])"
            :key="mode"
            type="button"
            class="flex flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2.5 text-center text-xs font-bold transition"
            :class="
              preference === mode
                ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary) hover:border-(--border-strong)'
            "
            :aria-pressed="preference === mode"
            @click="setPreference(mode)"
          >
            <Monitor v-if="mode === 'system'" class="h-4 w-4" aria-hidden="true" />
            <Sun v-else-if="mode === 'light'" class="h-4 w-4" aria-hidden="true" />
            <Moon v-else class="h-4 w-4" aria-hidden="true" />
            <span class="leading-tight">
              {{
                mode === 'system'
                  ? t('themeSystem')
                  : mode === 'light'
                    ? t('themeLight')
                    : t('themeDark')
              }}
            </span>
            <span
              v-if="mode === 'system'"
              class="text-[10px] font-normal text-(--text-muted)"
            >
              ({{ resolvedTheme === 'dark' ? t('themeDark') : t('themeLight') }})
            </span>
          </button>
        </div>
      </div>

      <!-- Endpoints & Consensus Card -->
      <div class="space-y-3 border-t border-(--border-card) pt-4">
        <div class="wallet-grid-2">
          <div>
            <label for="mob-net-select" class="block text-xs font-semibold mb-1.5">
              {{ t('networkLabel') }}
            </label>
            <select id="mob-net-select" v-model="networkInput" class="wallet-input text-xs">
              <option value="mainnet">Mainnet</option>
              <option value="testnet">Testnet</option>
              <option value="regtest">Regtest</option>
            </select>
          </div>
          <div>
            <label for="mob-autolock-input" class="block text-xs font-semibold mb-1.5">
              {{ t('autoLockLabel') }} ({{ t('minutesUnit') }})
            </label>
            <input
              id="mob-autolock-input"
              v-model.number="autoLockInput"
              type="number"
              min="1"
              max="120"
              class="wallet-input font-mono text-xs"
            />
          </div>
        </div>

        <div>
          <label for="mob-electrum-urls" class="block text-xs font-semibold mb-1.5">
            {{ t('electrumUrlsLabel') }}
          </label>
          <textarea
            id="mob-electrum-urls"
            v-model="electrumText"
            rows="2"
            class="wallet-input font-mono text-xs"
          />
        </div>

        <div>
          <label for="mob-explorer-url" class="block text-xs font-semibold mb-1.5">
            {{ t('explorerApiLabel') }}
          </label>
          <input
            id="mob-explorer-url"
            v-model="explorerInput"
            type="url"
            class="wallet-input font-mono text-xs"
          />
        </div>

        <p
          v-if="endpointStatus"
          class="rounded-xl px-3 py-2 text-xs font-semibold"
          :class="
            endpointErr
              ? 'bg-(--status-danger-bg) text-(--status-danger)'
              : 'bg-(--surface-elevated) text-(--accent)'
          "
        >
          {{ endpointStatus }}
        </p>

        <div class="toolbar">
          <button type="button" class="btn-primary !py-2 text-xs" @click="handleSaveEndpoints">
            {{ t('saveEndpointsBtn') }}
          </button>
          <button type="button" class="btn-secondary !py-2 text-xs" @click="handleTestConsensus">
            <Server class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
            <span>{{ t('testServersBtn') }}</span>
          </button>
        </div>
      </div>
    </section>

    <ConfirmActionDialog ref="confirmDialogRef" />
  </div>
</template>
