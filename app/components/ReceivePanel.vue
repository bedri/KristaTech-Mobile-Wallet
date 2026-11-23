<script setup lang="ts">
import { ArrowDownLeft, Plus, Share2 } from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { formatPaymentUri } from '@kristatech/sdk';
import CopyButton from '~/components/CopyButton.vue';
import TermBadge from '~/components/TermBadge.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { hapticImpact, sharePayment } from '~/utils/nativeBridge';

const store = useMobileWalletStore();
const { t } = useWalletI18n();

const addressMode = ref<'p2pkh' | 'taproot'>('p2pkh');
const requestAmount = ref('');
const requestLabel = ref('');
const canvasRef = ref<HTMLCanvasElement | null>(null);
const shareStatus = ref('');

const activeAddress = computed(() => {
  const addrs = store.trackedAddresses.value;
  if (addressMode.value === 'taproot' && addrs.taproot.length > 0) {
    return addrs.taproot[addrs.taproot.length - 1] ?? addrs.p2pkh[0] ?? '';
  }
  return addrs.p2pkh[addrs.p2pkh.length - 1] ?? addrs.taproot[0] ?? '';
});

const paymentUri = computed(() => {
  if (!activeAddress.value) return '';
  try {
    return formatPaymentUri({
      address: activeAddress.value,
      amount: requestAmount.value.trim() || undefined,
      label: requestLabel.value.trim() || undefined
    });
  } catch {
    return activeAddress.value;
  }
});

async function renderQr() {
  if (!canvasRef.value || !paymentUri.value) return;
  try {
    await QRCode.toCanvas(canvasRef.value, paymentUri.value, {
      width: 220,
      margin: 2,
      color: { dark: '#070b14', light: '#ffffff' }
    });
  } catch {
    // ignore invalid amount intermediate typing
  }
}

async function handleShare() {
  if (!paymentUri.value) return;
  void hapticImpact('light');
  const outcome = await sharePayment({
    title: 'KRISTA Payment Request',
    text: paymentUri.value
  });
  if (outcome === 'shared' || outcome === 'copied') {
    shareStatus.value = t('shareDoneMsg');
    setTimeout(() => {
      shareStatus.value = '';
    }, 2500);
  }
}

onMounted(() => {
  void renderQr();
});
watch([paymentUri, canvasRef], () => {
  void renderQr();
});
</script>

<template>
  <div class="space-y-4">
    <section class="card-surface p-4 sm:p-5 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2.5">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-400/15 text-(--accent-coral)">
            <ArrowDownLeft class="h-4 w-4" aria-hidden="true" />
          </div>
          <div class="flex items-center gap-1.5">
            <h2 class="text-base font-bold tracking-tight">{{ t('navReceive') }}</h2>
            <TermBadge term-id="taproot" />
          </div>
        </div>

        <button
          v-if="store.activeProfile.value?.mode !== 'wif'"
          type="button"
          class="btn-secondary !rounded-xl !px-3 !py-1.5 text-xs"
          @click="store.incrementAddressIndex(addressMode)"
        >
          <Plus class="h-3.5 w-3.5 text-(--accent)" aria-hidden="true" />
          <span>{{ t('nextAddressBtn') }}</span>
        </button>
      </div>

      <!-- Address Standard / Taproot Single-Row Tab Switcher -->
      <div
        v-if="store.trackedAddresses.value.taproot.length > 0"
        class="tab-strip"
        role="tablist"
        aria-label="Address format"
      >
        <button
          id="recv-tab-p2pkh"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="addressMode === 'p2pkh'"
          @click="addressMode = 'p2pkh'"
        >
          {{ t('receiveStandardTitle') }}
        </button>
        <button
          id="recv-tab-taproot"
          type="button"
          role="tab"
          class="tab-strip-btn"
          :aria-selected="addressMode === 'taproot'"
          @click="addressMode = 'taproot'"
        >
          {{ t('receiveTaprootTitle') }}
        </button>
      </div>

      <!-- Pure-White High-Contrast Framed QR Card -->
      <div
        :role="store.trackedAddresses.value.taproot.length > 0 ? 'tabpanel' : undefined"
        :aria-labelledby="
          store.trackedAddresses.value.taproot.length > 0 ? `recv-tab-${addressMode}` : undefined
        "
        class="flex flex-col items-center gap-3.5 py-1"
      >
        <div class="rounded-2xl bg-white p-3.5 shadow-lg ring-1 ring-black/10">
          <canvas ref="canvasRef" class="block rounded-lg" />
        </div>

        <p
          v-if="paymentUri && paymentUri !== activeAddress"
          class="max-w-full truncate rounded-full border border-(--border-card) bg-(--surface-elevated) px-3 py-1 font-mono text-[11px] text-(--accent)"
        >
          {{ paymentUri }}
        </p>

        <code
          id="mob-receive-addr"
          class="card-subtle w-full px-3.5 py-3 text-center font-mono text-xs font-bold break-all text-(--text-main)"
        >
          {{ activeAddress }}
        </code>

        <div class="flex flex-wrap items-center justify-center gap-2.5">
          <CopyButton
            target-id="mob-receive-addr"
            :label="t('copyBtn')"
            :copied-label="t('copiedMsg')"
            :failed-label="t('copyFailedMsg')"
          />
          <button
            type="button"
            class="btn-coral !rounded-xl !px-4 !py-2 text-xs"
            @click="handleShare"
          >
            <Share2 class="h-3.5 w-3.5" aria-hidden="true" />
            <span>{{ t('shareAddress') }}</span>
          </button>
        </div>

        <p v-if="shareStatus" role="status" class="text-xs font-semibold text-(--status-ok)">
          {{ shareStatus }}
        </p>
      </div>

      <!-- Optional Payment Request Parameters -->
      <div class="wallet-grid-2 border-t border-(--border-card) pt-3.5">
        <div>
          <label for="mob-req-amt" class="block text-xs font-semibold mb-1.5">
            {{ t('paymentAmountOpt') }}
          </label>
          <input
            id="mob-req-amt"
            v-model="requestAmount"
            type="text"
            inputmode="decimal"
            class="wallet-input font-mono text-xs"
            placeholder="10.0"
          />
        </div>
        <div>
          <label for="mob-req-lbl" class="block text-xs font-semibold mb-1.5">
            {{ t('paymentLabelOpt') }}
          </label>
          <input
            id="mob-req-lbl"
            v-model="requestLabel"
            type="text"
            class="wallet-input text-xs"
          />
        </div>
      </div>
    </section>
  </div>
</template>
