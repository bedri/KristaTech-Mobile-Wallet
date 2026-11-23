<script setup lang="ts">
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  LayoutGrid,
  Lock,
  Monitor,
  Moon,
  ScanLine,
  Sun,
  Wallet,
  WifiOff
} from 'lucide-vue-next';
import { computed, ref } from 'vue';
import GlossaryPanel from '~/components/GlossaryPanel.vue';
import HomePanel from '~/components/HomePanel.vue';
import MobileOnboarding from '~/components/MobileOnboarding.vue';
import MobileUnlock from '~/components/MobileUnlock.vue';
import MorePanel from '~/components/MorePanel.vue';
import QrScannerDialog from '~/components/QrScannerDialog.vue';
import ReceivePanel from '~/components/ReceivePanel.vue';
import SendPanel from '~/components/SendPanel.vue';
import { useMobileWalletStore, type MobileMainTab } from '~/composables/useMobileWalletStore';
import { useTheme } from '~/composables/useTheme';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { parseIncomingMobileLink } from '~/utils/deepLink';
import { hapticImpact } from '~/utils/nativeBridge';

const store = useMobileWalletStore();
const { t } = useWalletI18n();
const { preference, systemDark, resolvedTheme, setPreference } = useTheme();

const scannerRef = ref<InstanceType<typeof QrScannerDialog> | null>(null);
let pendingQrCallback: ((payload: string) => void) | null = null;

function openScanner(onDecoded?: (payload: string) => void) {
  pendingQrCallback = onDecoded ?? null;
  scannerRef.value?.open();
}

function handleQrDecoded(payload: string) {
  if (pendingQrCallback) {
    const cb = pendingQrCallback;
    pendingQrCallback = null;
    cb(payload);
    return;
  }
  const parsed = parseIncomingMobileLink(payload, store.currentNetwork.value);
  if (parsed.kind === 'payment') {
    store.applyIncomingLink(payload);
  } else {
    store.deepLinkNotice.value = null;
  }
}

function selectTab(tab: MobileMainTab) {
  void hapticImpact('light');
  store.activeTab.value = tab;
  store.touchActivity();
}

function cycleTheme() {
  void hapticImpact('light');
  const oppositeOfOs = systemDark.value ? 'light' : 'dark';
  const sameAsOs = systemDark.value ? 'dark' : 'light';
  if (preference.value === 'system') {
    setPreference(oppositeOfOs);
  } else if (preference.value === oppositeOfOs) {
    setPreference(sameAsOs);
  } else {
    setPreference('system');
  }
}

const themeAriaLabel = computed(() => {
  const modeLabel =
    preference.value === 'system'
      ? `${t('themeSystem')} (${resolvedTheme.value === 'dark' ? t('themeDark') : t('themeLight')})`
      : preference.value === 'light'
        ? t('themeLight')
        : t('themeDark');
  return `${t('appearanceLabel')}: ${modeLabel}`;
});

const networkLabel = computed(() => {
  const net = store.currentNetwork.value;
  return net.charAt(0).toUpperCase() + net.slice(1);
});

const navTabs: Array<{
  id: MobileMainTab;
  labelKey: 'navWallet' | 'navSend' | 'navReceive' | 'navGlossary' | 'navMore';
  icon: typeof Wallet;
}> = [
  { id: 'wallet', labelKey: 'navWallet', icon: Wallet },
  { id: 'send', labelKey: 'navSend', icon: ArrowUpRight },
  { id: 'receive', labelKey: 'navReceive', icon: ArrowDownLeft },
  { id: 'glossary', labelKey: 'navGlossary', icon: BookOpen },
  { id: 'more', labelKey: 'navMore', icon: LayoutGrid }
];
</script>

<template>
  <div
    class="min-h-dvh flex flex-col"
    @pointerdown="store.touchActivity"
    @keydown="store.touchActivity"
  >
    <!-- Top Safe-Area Frosted Mobile App Header -->
    <header class="mobile-header">
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          <div
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-(--border-card) bg-(--surface-card) p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <img src="/logo.svg" alt="KRISTA" class="h-full w-full object-contain" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <h1 class="truncate text-sm font-extrabold tracking-tight text-(--text-main)">
                {{ t('appName') }}
              </h1>
              <span
                v-if="store.hasWallet.value && store.isWatchOnly.value"
                class="shrink-0 rounded-md bg-(--status-warn-bg) px-1.5 py-0.5 text-[10px] font-bold text-(--status-warn)"
              >
                {{ t('watchOnlyBadge') }}
              </span>
            </div>
            <div class="flex items-center gap-1.5 text-[11px] font-mono text-(--text-muted) truncate">
              <span class="relative flex h-2 w-2 shrink-0">
                <span
                  v-if="store.connected.value"
                  class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:animate-none"
                />
                <span
                  class="relative inline-flex h-2 w-2 rounded-full"
                  :class="
                    store.connected.value
                      ? 'bg-emerald-500'
                      : store.networkOnline.value
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  "
                />
              </span>
              <span class="truncate">
                {{ networkLabel }}
                <template v-if="store.snapshot.value?.tip.height">
                  · #{{ store.snapshot.value.tip.height.toLocaleString() }}
                </template>
                <template v-else>
                  ·
                  {{
                    store.syncing.value
                      ? t('syncingLabel')
                      : store.connected.value
                        ? t('syncedLabel')
                        : t('offlineLabel')
                  }}
                </template>
              </span>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            class="icon-circle-btn"
            :aria-label="t('scanQr')"
            :title="t('scanQr')"
            @click="openScanner()"
          >
            <ScanLine class="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          <button
            type="button"
            class="icon-circle-btn"
            :aria-label="themeAriaLabel"
            :title="themeAriaLabel"
            @click="cycleTheme"
          >
            <Monitor v-if="preference === 'system'" class="h-[18px] w-[18px]" aria-hidden="true" />
            <Sun v-else-if="preference === 'light'" class="h-[18px] w-[18px]" aria-hidden="true" />
            <Moon v-else class="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          <button
            v-if="store.isUnlocked.value && !store.isWatchOnly.value"
            type="button"
            class="icon-circle-btn hover:!border-(--accent-coral) hover:!text-(--accent-coral)"
            :aria-label="t('lockWallet')"
            :title="t('lockWallet')"
            @click="store.lockWallet()"
          >
            <Lock class="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>

    <!-- Offline Notice -->
    <div v-if="!store.networkOnline.value" class="mx-auto mt-2.5 w-full max-w-3xl px-3.5">
      <p
        class="flex items-center gap-2 rounded-xl border border-(--status-warn)/30 bg-(--status-warn-bg) px-3.5 py-2 text-xs font-semibold text-(--status-warn)"
      >
        <WifiOff class="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{{ t('offlineBanner') }}</span>
      </p>
    </div>

    <!-- Main Container Query Shell -->
    <main class="mobile-main wallet-shell mx-auto w-full max-w-3xl flex-1 pt-4">
      <div v-if="!store.hydrated.value" class="py-12 text-center text-xs text-(--text-muted)">
        {{ t('syncingLabel') }}
      </div>

      <template v-else-if="store.activeTab.value === 'glossary'">
        <GlossaryPanel />
      </template>

      <template v-else-if="!store.hasWallet.value">
        <MobileOnboarding @request-scan-qr="(cb) => openScanner(cb)" />
      </template>

      <template v-else-if="!store.isUnlocked.value">
        <MobileUnlock />
      </template>

      <template v-else>
        <HomePanel v-if="store.activeTab.value === 'wallet'" @scan-qr-now="openScanner()" />
        <SendPanel
          v-else-if="store.activeTab.value === 'send'"
          @request-scan-qr="(cb) => openScanner(cb)"
        />
        <ReceivePanel v-else-if="store.activeTab.value === 'receive'" />
        <MorePanel v-else-if="store.activeTab.value === 'more'" />
      </template>
    </main>

    <!-- Fixed Frosted 5-Icon Bottom Dock with Safe-Area Padding -->
    <nav class="bottom-dock" aria-label="Primary Mobile Navigation">
      <div class="mx-auto grid max-w-3xl grid-cols-5 gap-1">
        <button
          v-for="tab in navTabs"
          :key="tab.id"
          type="button"
          class="bottom-dock-item"
          :aria-current="store.activeTab.value === tab.id ? 'page' : undefined"
          @click="selectTab(tab.id)"
        >
          <span
            class="flex h-7 w-11 items-center justify-center rounded-full transition-colors"
            :class="
              store.activeTab.value === tab.id
                ? 'bg-cobalt-400/15 text-(--accent)'
                : 'text-current'
            "
          >
            <component :is="tab.icon" class="h-[19px] w-[19px]" aria-hidden="true" />
          </span>
          <span class="max-w-full truncate px-1 text-[11px] font-semibold tracking-wide">
            {{ t(tab.labelKey) }}
          </span>
        </button>
      </div>
    </nav>

    <QrScannerDialog ref="scannerRef" @decoded="handleQrDecoded" />
  </div>
</template>
