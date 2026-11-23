<script setup lang="ts">
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Lock,
  ScanLine,
  Send,
  SlidersHorizontal,
  Sparkles,
  Zap
} from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { getNetwork, satoshisToKrista } from '@kristatech/sdk';
import ConfirmActionDialog from '~/components/ConfirmActionDialog.vue';
import CopyButton from '~/components/CopyButton.vue';
import TermBadge from '~/components/TermBadge.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { parseIncomingMobileLink } from '~/utils/deepLink';
import { formatCompactKrista } from '~/utils/formatBalance';
import { hapticImpact, hapticNotify } from '~/utils/nativeBridge';
import { prepareAndSignSend, sanitizeExplorerBrowserUrl } from '~/utils/walletCore';

const emit = defineEmits<{
  requestScanQr: [onResult: (payload: string) => void];
}>();

const store = useMobileWalletStore();
const { t } = useWalletI18n();

const confirmDialogRef = ref<InstanceType<typeof ConfirmActionDialog> | null>(null);

const recipient = ref('');
const amount = ref('');
const subtractFee = ref(false);
const feeTier = ref<'economy' | 'standard' | 'fast'>('standard');
const opReturnMemo = ref('');
const polLockHeight = ref('');
const deepLinkBanner = ref('');
const busy = ref(false);
const errorMsg = ref('');
const sentTxid = ref('');

const explorerTxUrl = computed(() => {
  if (!sentTxid.value) return '';
  const base = sanitizeExplorerBrowserUrl(
    store.currentEndpoints.value.explorerBrowserUrl,
    store.currentNetwork.value
  );
  return base ? `${base}/tx/${encodeURIComponent(sentTxid.value)}` : '';
});

const spendableText = computed(() =>
  formatCompactKrista(satoshisToKrista(store.snapshot.value?.spendableSatoshis ?? 0n))
);

const feeTierOptions = computed(() => {
  const fees = store.snapshot.value?.fees;
  const fallbackMin = getNetwork(store.currentNetwork.value).minRelayFeePerKb;
  const economyRate = fees?.economySatPerKb ?? fallbackMin;
  const standardRate = fees?.standardSatPerKb ?? fallbackMin;
  const fastRate = fees?.fastSatPerKb ?? fallbackMin;
  return [
    {
      id: 'economy' as const,
      label: t('feeEconomy'),
      rate: `${economyRate.toString()} sat/KB`,
      icon: Clock
    },
    {
      id: 'standard' as const,
      label: t('feeStandard'),
      rate: `${standardRate.toString()} sat/KB`,
      icon: Zap
    },
    {
      id: 'fast' as const,
      label: t('feeFast'),
      rate: `${fastRate.toString()} sat/KB`,
      icon: Sparkles
    }
  ];
});

function applyScannedOrDeepLink(raw: string) {
  const parsed = parseIncomingMobileLink(raw, store.currentNetwork.value);
  if (parsed.kind === 'payment') {
    recipient.value = parsed.address;
    if (parsed.amountKrista) amount.value = parsed.amountKrista;
    if (parsed.label) deepLinkBanner.value = parsed.label;
    errorMsg.value = '';
  } else {
    errorMsg.value = parsed.reason;
    void hapticNotify('error');
  }
}

function consumePendingUri() {
  const pending = store.consumePendingDeepLink();
  if (!pending) return;
  recipient.value = pending.address;
  if (pending.amountKrista) amount.value = pending.amountKrista;
  deepLinkBanner.value = pending.label || t('deepLinkLoaded');
  store.deepLinkNotice.value = null;
}

onMounted(consumePendingUri);
watch(() => store.pendingDeepLink.value, consumePendingUri);

function fillMax() {
  void hapticImpact('light');
  const spendable = store.snapshot.value?.spendableSatoshis ?? 0n;
  amount.value = satoshisToKrista(spendable);
  subtractFee.value = spendable > 0n;
}

function getSelectedFeeRate(): bigint | undefined {
  const fees = store.snapshot.value?.fees;
  const fallbackMin = getNetwork(store.currentNetwork.value).minRelayFeePerKb;
  if (!fees) return fallbackMin;
  if (feeTier.value === 'economy') return fees.economySatPerKb;
  if (feeTier.value === 'fast') return fees.fastSatPerKb;
  return fees.standardSatPerKb;
}

async function handleReviewAndSend() {
  errorMsg.value = '';
  sentTxid.value = '';
  const sess = store.session.value;
  const prof = store.activeProfile.value;
  const snap = store.snapshot.value;
  if (!sess || !prof) {
    errorMsg.value = t('unlockTitle');
    return;
  }
  if (!snap) {
    await store.refreshSync();
  }
  const latestSnap = store.snapshot.value;
  if (!latestSnap) {
    errorMsg.value = t('offlineBanner');
    return;
  }

  const lockStr = polLockHeight.value.trim();
  let parsedLock: number | undefined;
  if (lockStr) {
    if (!/^\d+$/.test(lockStr)) {
      errorMsg.value = `PoL lock height must be a positive integer (> #${latestSnap.tip.height})`;
      void hapticNotify('error');
      return;
    }
    parsedLock = Number.parseInt(lockStr, 10);
    if (!Number.isSafeInteger(parsedLock) || parsedLock <= latestSnap.tip.height) {
      errorMsg.value = `PoL lock height must exceed current tip (#${latestSnap.tip.height})`;
      void hapticNotify('error');
      return;
    }
  }

  let prepared: ReturnType<typeof prepareAndSignSend>;
  try {
    prepared = prepareAndSignSend({
      network: prof.network,
      session: sess,
      utxos: latestSnap.utxos,
      recipientInput: recipient.value,
      amountStr: amount.value,
      subtractFee: subtractFee.value,
      feeRatePerKb: getSelectedFeeRate(),
      changeAddress: store.trackedAddresses.value.p2pkh[0]!,
      currentHeight: latestSnap.tip.height,
      opReturnMemo: opReturnMemo.value || undefined,
      lockHeight: parsedLock,
      receiveCount: prof.receiveCount,
      taprootCount: prof.taprootCount
    });
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    void hapticNotify('error');
    return;
  }

  const confirmRows: Array<{ label: string; value: string }> = [
    { label: t('confirmDestLabel'), value: prepared.destinationAddress },
    { label: t('confirmAmountLabel'), value: `${satoshisToKrista(prepared.signed.tx.outputs[0]!.satoshis)} KRISTA` },
    { label: t('confirmFeeLabel'), value: `${satoshisToKrista(prepared.signed.feeSatoshis)} KRISTA` },
    { label: t('confirmChangeLabel'), value: `${satoshisToKrista(prepared.signed.changeSatoshis)} KRISTA` },
    { label: 'TX Size', value: `${prepared.signed.size} B` }
  ];
  if (prepared.polLockHeight) {
    confirmRows.push({ label: t('polLockHeightLabel'), value: `#${prepared.polLockHeight}` });
  }
  if (opReturnMemo.value.trim()) {
    confirmRows.push({ label: t('opReturnMemoLabel'), value: opReturnMemo.value.trim() });
  }

  const confirmed = await confirmDialogRef.value?.ask({
    title: t('confirmSendTitle'),
    description: prepared.opReturn1000xWarning ? t('opReturn1000xWarn') : undefined,
    rows: confirmRows,
    confirmLabel: t('signAndBroadcastBtn'),
    destructive: false
  });

  if (!confirmed) return;

  busy.value = true;
  try {
    await store.verifySelectedTransactionInputs(prepared.signed);
    const txid = await store.broadcastRawTx(prepared.signed.hex);
    sentTxid.value = txid;
    recipient.value = '';
    amount.value = '';
    opReturnMemo.value = '';
    polLockHeight.value = '';
    deepLinkBanner.value = '';
    void hapticNotify('success');
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    void hapticNotify('error');
  } finally {
    busy.value = false;
  }
}

function triggerQrScan() {
  void hapticImpact('light');
  emit('requestScanQr', applyScannedOrDeepLink);
}
</script>

<template>
  <div class="space-y-4">
    <section class="card-surface p-4 sm:p-5 space-y-4">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-cobalt-400/15 text-(--accent)">
            <ArrowUpRight class="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 class="text-base font-bold tracking-tight">{{ t('navSend') }}</h2>
            <p class="font-mono text-[11px] text-(--text-muted)">
              {{ t('spendableBalance') }}: {{ spendableText }} KRISTA
            </p>
          </div>
        </div>

        <button
          type="button"
          class="btn-secondary !rounded-xl !px-3 !py-1.5 text-xs"
          @click="triggerQrScan"
        >
          <ScanLine class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
          <span>{{ t('scanQr') }}</span>
        </button>
      </div>

      <p
        v-if="deepLinkBanner"
        class="flex items-center gap-2 rounded-xl border border-(--status-ok)/30 bg-(--status-ok-bg) px-3.5 py-2 text-xs font-semibold text-(--status-ok)"
      >
        <CheckCircle2 class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{{ t('deepLinkLoaded') }} ({{ deepLinkBanner }})</span>
      </p>

      <div
        v-if="store.isWatchOnly.value"
        class="flex items-start gap-2.5 rounded-xl border border-(--status-warn)/30 bg-(--status-warn-bg) p-3.5 text-xs font-medium text-(--status-warn)"
      >
        <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{{ t('watchOnlyBadge') }} — {{ t('psbtBuildTitle') }}</span>
      </div>

      <form v-else class="space-y-4" @submit.prevent="handleReviewAndSend">
        <!-- Recipient Address Card -->
        <div class="card-subtle p-3.5 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label for="mob-send-to" class="block text-xs font-bold text-(--text-main)">
              {{ t('recipientLabel') }}
            </label>
            <button
              type="button"
              class="icon-hit-expand inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold text-(--accent) hover:bg-(--surface-elevated)"
              :aria-label="t('scanQr')"
              @click="triggerQrScan"
            >
              <ScanLine class="h-3.5 w-3.5" aria-hidden="true" />
              <span>QR</span>
            </button>
          </div>
          <span id="mob-send-to-hint" class="field-hint">{{ t('recipientHint') }}</span>
          <input
            id="mob-send-to"
            v-model="recipient"
            type="text"
            required
            class="wallet-input font-mono text-xs"
            aria-describedby="mob-send-to-hint"
            data-error="mob-send-to-err"
            placeholder="KT... or kt1p..."
          />
          <div id="mob-send-to-err" class="error-msg">
            <span role="img" aria-label="Error">⚠</span> {{ t('recipientError') }}
          </div>
        </div>

        <!-- Amount Card -->
        <div class="card-subtle p-3.5 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label for="mob-send-amt" class="block text-xs font-bold text-(--text-main)">
              {{ t('amountLabel') }}
            </label>
            <button
              type="button"
              class="rounded-full border border-(--border-strong) bg-cobalt-400/15 px-3 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-(--accent) transition hover:border-(--accent)"
              @click="fillMax"
            >
              {{ t('maxBtn') }}
            </button>
          </div>
          <input
            id="mob-send-amt"
            v-model="amount"
            type="text"
            inputmode="decimal"
            required
            pattern="^\d+(\.\d{1,8})?$"
            class="wallet-input font-mono text-base font-bold tabular-nums"
            data-error="mob-send-amt-err"
            placeholder="0.00000000"
          />
          <div id="mob-send-amt-err" class="error-msg">
            <span role="img" aria-label="Error">⚠</span> {{ t('amountError') }}
          </div>
        </div>

        <!-- Fee Priority Selector (Real sat/KB rates from snapshot.fees) -->
        <div class="space-y-2">
          <span class="block text-xs font-bold text-(--text-main)">{{ t('feeTierLabel') }}</span>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="tier in feeTierOptions"
              :key="tier.id"
              type="button"
              class="flex flex-col items-center justify-center gap-1 rounded-2xl border px-2 py-2.5 text-center transition"
              :class="
                feeTier === tier.id
                  ? 'border-(--accent) bg-cobalt-400/15 text-(--accent)'
                  : 'border-(--border-card) bg-(--surface-subtle) text-(--text-secondary) hover:border-(--border-strong)'
              "
              :aria-pressed="feeTier === tier.id"
              @click="feeTier = tier.id"
            >
              <component :is="tier.icon" class="h-4 w-4" aria-hidden="true" />
              <span class="text-xs font-bold">{{ tier.label }}</span>
              <span class="font-mono text-[10px] text-(--text-muted) tabular-nums">
                {{ tier.rate }}
              </span>
            </button>
          </div>
        </div>

        <!-- Advanced Options (OP_RETURN 1000x notice + PoL CLTV Height) -->
        <details class="card-subtle p-3.5">
          <summary class="flex cursor-pointer items-center gap-2 text-xs font-bold text-(--accent)">
            <SlidersHorizontal class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{{ t('advancedOptions') }}</span>
          </summary>

          <div class="mt-3 space-y-3 border-t border-(--border-card) pt-3">
            <div>
              <label for="mob-send-memo" class="block text-xs font-semibold mb-1.5">
                {{ t('opReturnMemoLabel') }}
              </label>
              <input
                id="mob-send-memo"
                v-model="opReturnMemo"
                type="text"
                class="wallet-input text-xs"
              />
              <p
                v-if="opReturnMemo.trim()"
                class="mt-2 flex items-start gap-1.5 rounded-xl bg-(--status-warn-bg) p-2.5 text-[11px] font-medium text-(--status-warn)"
              >
                <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{{ t('opReturn1000xWarn') }}</span>
              </p>
            </div>

            <div>
              <div class="flex items-center gap-1.5 mb-0.5">
                <Lock class="h-3.5 w-3.5 text-(--status-warn)" aria-hidden="true" />
                <label for="mob-send-pol" class="block text-xs font-semibold">
                  {{ t('polLockHeightLabel') }}
                </label>
                <TermBadge term-id="pol" />
              </div>
              <span class="field-hint">
                {{ t('polLockHint', { tip: store.snapshot.value?.tip.height ?? 0 }) }}
              </span>
              <input
                id="mob-send-pol"
                v-model="polLockHeight"
                type="number"
                inputmode="numeric"
                min="0"
                class="wallet-input font-mono text-xs"
              />
            </div>
          </div>
        </details>

        <p
          v-if="errorMsg"
          class="flex items-start gap-2 rounded-xl bg-(--status-danger-bg) p-3 text-xs font-medium text-(--status-danger)"
        >
          <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{{ errorMsg }}</span>
        </p>

        <button type="submit" :disabled="busy" class="btn-primary w-full">
          <Send class="h-4 w-4" aria-hidden="true" />
          <span>{{ t('reviewSendBtn') }}</span>
        </button>
      </form>

      <!-- Broadcast Confirmation Receipt -->
      <div
        v-if="sentTxid"
        class="rounded-2xl border border-(--status-ok)/35 bg-(--status-ok-bg) p-4 space-y-3"
      >
        <div class="flex items-center gap-2 text-xs font-bold text-(--status-ok)">
          <CheckCircle2 class="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{{ t('txBroadcastSuccess', { txid: '' }) }}</span>
        </div>
        <code
          id="mob-sent-txid"
          class="block rounded-xl border border-(--border-card) bg-(--surface-card) p-3 font-mono text-[11px] font-semibold break-all text-(--text-main)"
        >
          {{ sentTxid }}
        </code>
        <div class="flex flex-wrap items-center gap-2">
          <CopyButton
            target-id="mob-sent-txid"
            :label="t('copyBtn')"
            :copied-label="t('copiedMsg')"
            :failed-label="t('copyFailedMsg')"
          />
          <a
            v-if="explorerTxUrl"
            :href="explorerTxUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-secondary !rounded-xl !px-3 !py-1.5 text-xs text-(--accent)"
          >
            <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ t('openInExplorer') }}</span>
          </a>
        </div>
      </div>
    </section>

    <ConfirmActionDialog ref="confirmDialogRef" />
  </div>
</template>
