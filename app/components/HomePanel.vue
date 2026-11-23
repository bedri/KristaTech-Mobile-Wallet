<script setup lang="ts">
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Lock,
  Radio,
  RefreshCw,
  ScanLine,
  Shield,
  ShieldCheck
} from 'lucide-vue-next';
import { computed, ref } from 'vue';
import { satoshisToKrista } from '@kristatech/sdk';
import TermBadge from '~/components/TermBadge.vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { formatCompactKrista, splitKristaBalance } from '~/utils/formatBalance';
import { hapticImpact } from '~/utils/nativeBridge';

const emit = defineEmits<{
  scanQrNow: [];
}>();

const store = useMobileWalletStore();
const { t } = useWalletI18n();

const hideBalance = ref(false);
const verifyingTxid = ref<string | null>(null);

const spendableSats = computed(() => store.snapshot.value?.spendableSatoshis ?? 0n);
const lockedSats = computed(() => store.snapshot.value?.lockedSatoshis ?? 0n);
const immatureSats = computed(() => store.snapshot.value?.immatureSatoshis ?? 0n);
const pendingSats = computed(() => store.snapshot.value?.unconfirmedSatoshis ?? 0n);
const totalSats = computed(
  () => spendableSats.value + lockedSats.value + immatureSats.value + pendingSats.value
);

const spendableText = computed(() => satoshisToKrista(spendableSats.value));
const spendableParts = computed(() => splitKristaBalance(spendableText.value));
const lockedText = computed(() => formatCompactKrista(satoshisToKrista(lockedSats.value)));
const immatureText = computed(() => formatCompactKrista(satoshisToKrista(immatureSats.value)));
const pendingText = computed(() => formatCompactKrista(satoshisToKrista(pendingSats.value)));
const totalText = computed(() => formatCompactKrista(satoshisToKrista(totalSats.value)));

const recentHistory = computed(() => (store.snapshot.value?.history ?? []).slice(0, 6));
const tipHeight = computed(() => store.snapshot.value?.tip.height ?? 0);
const utxoCount = computed(() => store.snapshot.value?.utxos.length ?? 0);

const primaryElectrumHost = computed(() => {
  const raw = store.currentEndpoints.value.electrumUrls[0] ?? '';
  if (!raw) return 'Electrum SPV';
  try {
    return new URL(raw).host || raw;
  } catch {
    return raw.replace(/^wss?:\/\//, '');
  }
});

function shortTxid(txid: string): string {
  return txid.length > 18 ? `${txid.slice(0, 10)}…${txid.slice(-8)}` : txid;
}

function goTab(tab: 'send' | 'receive' | 'more') {
  void hapticImpact('light');
  store.activeTab.value = tab;
}

async function handleVerifySpv(txid: string) {
  if (verifyingTxid.value) return;
  verifyingTxid.value = txid;
  void hapticImpact('light');
  try {
    await store.verifyTxSpv(txid);
  } finally {
    verifyingTxid.value = null;
  }
}
</script>

<template>
  <div class="relative space-y-4">
    <!-- Ambient Cobalt/Coral Halo -->
    <div
      class="pointer-events-none absolute -top-6 left-1/2 h-36 w-72 -translate-x-1/2 rounded-full bg-gradient-to-r from-cobalt-400/20 via-coral-400/15 to-transparent blur-3xl"
      aria-hidden="true"
    />

    <!-- Obsidian / Porcelain Hero Portfolio Vault Card -->
    <section class="vault-hero p-5 space-y-4">
      <div
        class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-(--border-strong) to-transparent"
        aria-hidden="true"
      />

      <!-- Header: Label + Visibility Toggle + Live Sync Pill -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <p class="text-[11px] font-bold uppercase tracking-wider text-(--text-muted)">
            {{ t('spendableBalance') }}
          </p>
          <button
            type="button"
            class="icon-hit-expand inline-flex items-center justify-center rounded-lg p-0.5 text-(--text-muted) transition hover:text-(--accent)"
            :aria-label="hideBalance ? 'Show balance' : 'Hide balance'"
            :aria-pressed="hideBalance"
            @click="hideBalance = !hideBalance"
          >
            <EyeOff v-if="hideBalance" class="h-4 w-4" aria-hidden="true" />
            <Eye v-else class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          :disabled="store.syncing.value"
          class="inline-flex items-center gap-1.5 rounded-full border border-(--border-card) bg-(--surface-subtle) px-3 py-1 font-mono text-[11px] font-semibold text-(--text-secondary) transition hover:border-(--accent) disabled:opacity-55"
          @click="store.refreshSync()"
        >
          <span
            class="inline-block h-1.5 w-1.5 rounded-full"
            :class="
              store.connected.value
                ? 'bg-emerald-500'
                : store.networkOnline.value
                  ? 'bg-amber-500'
                  : 'bg-red-500'
            "
          />
          <span>
            {{
              store.syncing.value
                ? t('syncingLabel')
                : store.connected.value
                  ? t('syncedLabel')
                  : t('refreshNow')
            }}
          </span>
          <RefreshCw
            class="h-3 w-3 text-(--accent)"
            :class="{ 'animate-spin motion-reduce:animate-none': store.syncing.value }"
            aria-hidden="true"
          />
        </button>
      </div>

      <!-- Primary KRISTA Balance Display (Real Chain Data Only) -->
      <div class="space-y-1.5">
        <div class="flex flex-wrap items-baseline gap-1 tabular-nums">
          <span class="text-3xl sm:text-4xl font-extrabold tracking-tight text-(--text-main)">
            {{ hideBalance ? '••••••' : spendableParts.whole }}
          </span>
          <span class="font-mono text-xl sm:text-2xl font-medium text-(--text-muted)">
            {{ hideBalance ? '.••••••••' : spendableParts.fraction }}
          </span>
          <span
            class="ml-1.5 rounded-md bg-coral-400/15 px-2 py-0.5 font-mono text-[11px] font-bold tracking-wide text-(--accent-coral)"
          >
            KRISTA
          </span>
        </div>

        <!-- Real Total & Vault Identity Summary -->
        <div class="flex flex-wrap items-center gap-2 text-xs text-(--text-muted)">
          <span class="font-mono tabular-nums">
            {{ t('totalBalance') }}:
            <strong class="font-semibold text-(--text-secondary)">
              {{ hideBalance ? '••••••' : totalText }} KRISTA
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span class="truncate font-medium text-(--text-secondary)">
            {{ store.activeProfile.value?.label }}
          </span>
        </div>
      </div>

      <!-- 3 Sleek Quick-Action Tiles -->
      <div class="grid grid-cols-3 gap-2.5 pt-1">
        <button
          type="button"
          class="group flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border-card) bg-(--surface-elevated)/75 px-2 py-3 transition hover:border-(--accent) active:scale-[0.97]"
          @click="goTab('send')"
        >
          <span
            class="flex h-10 w-10 items-center justify-center rounded-full bg-cobalt-400/15 text-(--accent) transition group-hover:bg-cobalt-400/25"
          >
            <ArrowUpRight class="h-5 w-5" aria-hidden="true" />
          </span>
          <span class="text-xs font-bold tracking-wide text-(--text-main)">
            {{ t('quickSend') }}
          </span>
        </button>

        <button
          type="button"
          class="group flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border-card) bg-(--surface-elevated)/75 px-2 py-3 transition hover:border-(--accent-coral) active:scale-[0.97]"
          @click="goTab('receive')"
        >
          <span
            class="flex h-10 w-10 items-center justify-center rounded-full bg-coral-400/15 text-(--accent-coral) transition group-hover:bg-coral-400/25"
          >
            <ArrowDownLeft class="h-5 w-5" aria-hidden="true" />
          </span>
          <span class="text-xs font-bold tracking-wide text-(--text-main)">
            {{ t('quickReceive') }}
          </span>
        </button>

        <button
          type="button"
          class="group flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-(--border-card) bg-(--surface-elevated)/75 px-2 py-3 transition hover:border-(--border-strong) active:scale-[0.97]"
          @click="emit('scanQrNow')"
        >
          <span
            class="flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-card) text-(--text-secondary) transition group-hover:text-(--text-main)"
          >
            <ScanLine class="h-5 w-5" aria-hidden="true" />
          </span>
          <span class="text-xs font-bold tracking-wide text-(--text-main)">
            {{ t('scanQr') }}
          </span>
        </button>
      </div>
    </section>

    <!-- Protected Balance Strip (Stacked Ledger Rows on <640px, 3 Columns on Tablet+) -->
    <section class="card-surface p-3.5 space-y-2.5">
      <div class="grid grid-cols-1 divide-y divide-(--border-card) sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <!-- PoL Locked -->
        <div
          class="flex items-center justify-between gap-3 py-2 first:pt-0.5 last:pb-0.5 sm:flex-col sm:items-start sm:justify-start sm:py-0 sm:pr-3"
        >
          <div class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-(--status-warn)">
            <Lock class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t('lockedBalance') }}</span>
            <TermBadge term-id="pol" class="shrink-0" />
          </div>
          <div class="shrink-0 text-right sm:mt-1 sm:w-full sm:text-left">
            <span class="font-mono text-xs font-bold tabular-nums text-(--text-main)">
              {{ hideBalance ? '••••' : lockedText }}
            </span>
            <span class="ml-1 font-mono text-[10px] text-(--text-muted)">KRISTA</span>
          </div>
        </div>

        <!-- Immature -->
        <div
          class="flex items-center justify-between gap-3 py-2 first:pt-0.5 last:pb-0.5 sm:flex-col sm:items-start sm:justify-start sm:px-3 sm:py-0"
        >
          <div class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-(--accent)">
            <Clock class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t('immatureBalance') }}</span>
          </div>
          <div class="shrink-0 text-right sm:mt-1 sm:w-full sm:text-left">
            <span class="font-mono text-xs font-bold tabular-nums text-(--text-main)">
              {{ hideBalance ? '••••' : immatureText }}
            </span>
            <span class="ml-1 font-mono text-[10px] text-(--text-muted)">
              {{ tipHeight > 0 ? `#${tipHeight.toLocaleString()}` : 'KRISTA' }}
            </span>
          </div>
        </div>

        <!-- Pending -->
        <div
          class="flex items-center justify-between gap-3 py-2 first:pt-0.5 last:pb-0.5 sm:flex-col sm:items-start sm:justify-start sm:pl-3 sm:py-0"
        >
          <div class="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-(--accent-coral)">
            <Radio class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span class="truncate">{{ t('pendingBalance') }}</span>
          </div>
          <div class="shrink-0 text-right sm:mt-1 sm:w-full sm:text-left">
            <span class="font-mono text-xs font-bold tabular-nums text-(--text-main)">
              {{ hideBalance ? '••••' : pendingText }}
            </span>
            <span class="ml-1 font-mono text-[10px] text-(--text-muted)">KRISTA</span>
          </div>
        </div>
      </div>

      <p class="border-t border-(--border-card) pt-2 text-[11px] text-(--text-muted)">
        {{ t('protectedUtxoNote') }}
      </p>
    </section>

    <!-- Compact SPV Node Info Banner -->
    <section
      class="card-surface flex items-center justify-between gap-2 px-3.5 py-2.5"
    >
      <div class="flex flex-1 items-center gap-2 min-w-0">
        <div
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
          :class="
            store.connected.value
              ? 'bg-(--status-ok-bg) text-(--status-ok)'
              : 'bg-(--status-warn-bg) text-(--status-warn)'
          "
        >
          <ShieldCheck v-if="store.connected.value" class="h-3.5 w-3.5" aria-hidden="true" />
          <Radio v-else class="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <div class="flex items-center gap-1.5 min-w-0 text-[11px]">
          <span class="truncate font-semibold text-(--text-main)">
            {{ primaryElectrumHost }}
          </span>
          <span class="text-(--text-muted)" aria-hidden="true">·</span>
          <span
            class="shrink-0 font-mono font-semibold"
            :class="store.connected.value ? 'text-(--status-ok)' : 'text-(--status-warn)'"
          >
            {{ store.connected.value ? t('syncedLabel') : t('offlineLabel') }}
          </span>
        </div>
      </div>

      <div class="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-(--text-muted)">
        <span>{{ utxoCount }} UTXOs</span>
        <TermBadge term-id="spv" />
      </div>
    </section>

    <!-- Sync Error Banner (when present) -->
    <p
      v-if="store.syncError.value"
      class="flex items-start gap-2 rounded-xl border border-(--status-danger)/30 bg-(--status-danger-bg) px-3.5 py-2.5 text-xs font-medium text-(--status-danger)"
    >
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span class="break-words">{{ store.syncError.value }}</span>
    </p>

    <!-- Recent Activity Feed Cards -->
    <section class="space-y-2.5">
      <div class="flex items-center justify-between gap-2 px-0.5">
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-bold tracking-tight text-(--text-main)">
            {{ t('historyTab') }}
          </h3>
          <span
            class="rounded-full bg-(--surface-elevated) px-2 py-0.5 font-mono text-[10px] font-bold text-(--text-muted)"
          >
            {{ recentHistory.length }}
          </span>
          <TermBadge term-id="spv" />
        </div>

        <button
          type="button"
          class="group inline-flex items-center gap-0.5 text-xs font-semibold text-(--accent) transition hover:underline"
          @click="goTab('more')"
        >
          <span>{{ t('moreActivity') }}</span>
          <ChevronRight
            class="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      </div>

      <div v-if="!recentHistory.length" class="card-surface py-8 px-4 text-center space-y-2">
        <div
          class="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-(--surface-elevated) text-(--text-muted)"
        >
          <Activity class="h-5 w-5" aria-hidden="true" />
        </div>
        <p class="text-xs text-(--text-muted)">{{ t('noHistoryYet') }}</p>
      </div>

      <ul v-else class="space-y-2">
        <li
          v-for="item in recentHistory"
          :key="item.txid"
          class="card-surface flex items-center justify-between gap-3 p-3.5 transition hover:border-(--border-strong)"
        >
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              :class="
                item.netSatoshis !== undefined
                  ? item.netSatoshis >= 0n
                    ? 'bg-(--status-ok-bg) text-(--status-ok)'
                    : 'bg-coral-400/15 text-(--accent-coral)'
                  : (item.height ?? 0) > 0
                    ? 'bg-cobalt-400/15 text-(--accent)'
                    : 'bg-(--status-warn-bg) text-(--status-warn)'
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
              <Clock v-else-if="(item.height ?? 0) <= 0" class="h-4 w-4" aria-hidden="true" />
              <Activity v-else class="h-4 w-4" aria-hidden="true" />
            </div>

            <div class="min-w-0 space-y-1">
              <div class="flex items-center gap-1.5 min-w-0">
                <p class="truncate font-mono text-xs font-bold text-(--text-main)">
                  {{ shortTxid(item.txid) }}
                </p>
                <span
                  v-if="item.txType"
                  class="shrink-0 rounded bg-(--surface-elevated) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--text-muted)"
                >
                  {{ item.txType }}
                </span>
              </div>

              <p class="font-mono text-[11px] text-(--text-muted)">
                {{
                  (item.height ?? 0) > 0
                    ? t('confirmedLabel', { n: Math.max(1, tipHeight - (item.height ?? 0) + 1) })
                    : t('unconfirmedLabel')
                }}
              </p>

              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  v-if="store.spvResults.value[item.txid]?.verified"
                  class="inline-flex items-center gap-1 rounded-full bg-(--status-ok-bg) px-2 py-0.5 font-mono text-[10px] font-bold text-(--status-ok)"
                >
                  <ShieldCheck class="h-3 w-3" aria-hidden="true" />
                  <span>
                    {{ t('spvVerified') }} ({{ store.spvResults.value[item.txid]?.crossChecked ? '2+ servers' : '1 server' }})
                  </span>
                </span>
                <span
                  v-else-if="store.spvResults.value[item.txid] && !store.spvResults.value[item.txid]?.verified"
                  class="inline-flex items-center gap-1 rounded-full bg-(--status-danger-bg) px-2 py-0.5 font-mono text-[10px] font-bold text-(--status-danger)"
                >
                  <AlertTriangle class="h-3 w-3" aria-hidden="true" />
                  <span>{{ t('spvFailed') }}</span>
                </span>
                <button
                  v-else-if="(item.height ?? 0) > 0"
                  type="button"
                  :disabled="verifyingTxid === item.txid"
                  class="inline-flex items-center gap-1 rounded-full border border-(--border-strong) bg-(--surface-elevated) px-2.5 py-0.5 text-[11px] font-semibold text-(--accent) transition hover:border-(--accent) disabled:opacity-50"
                  @click="handleVerifySpv(item.txid)"
                >
                  <Shield class="h-3 w-3" aria-hidden="true" />
                  <span>{{ t('verifySpvBtn') }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="shrink-0 text-right">
            <span
              v-if="item.netSatoshis !== undefined"
              class="block font-mono text-xs font-bold tabular-nums"
              :class="item.netSatoshis >= 0n ? 'text-(--status-ok)' : 'text-(--accent-coral)'"
            >
              {{ hideBalance ? '••••' : `${item.netSatoshis >= 0n ? '+' : ''}${formatCompactKrista(satoshisToKrista(item.netSatoshis))}` }}
              KRISTA
            </span>
            <span
              v-else-if="(item.height ?? 0) > 0"
              class="rounded-md bg-(--surface-elevated) px-2 py-0.5 font-mono text-[11px] font-semibold text-(--text-secondary)"
            >
              #{{ item.height }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
