<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useMobileWalletStore } from '~/composables/useMobileWalletStore';
import { useTheme } from '~/composables/useTheme';
import { useWalletI18n } from '~/composables/useWalletI18n';
import { initAccessibleFormValidation } from '~/utils/formAriaSync';
import {
  hideNativeSplash,
  isNativePlatform,
  subscribeNativeLifecycle
} from '~/utils/nativeBridge';

useTheme();
const { locale, hydrateLocale } = useWalletI18n();
const store = useMobileWalletStore();

let teardownValidation: (() => void) | null = null;
let teardownNative: (() => void) | null = null;

onMounted(async () => {
  await Promise.all([hydrateLocale(), store.hydrate()]);

  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale.value;
    teardownValidation = initAccessibleFormValidation(document);
  }

  teardownNative = subscribeNativeLifecycle({
    onBackground: () => store.handleAppBackground(),
    onResume: () => {
      void store.handleAppResume();
    },
    onDeepLink: (url) => {
      store.applyIncomingLink(url);
    },
    onBackButton: () => {
      if (store.activeTab.value !== 'wallet') {
        store.activeTab.value = 'wallet';
      }
    },
    onNetworkChange: (online) => {
      store.networkOnline.value = online;
      if (online && store.hasWallet.value) {
        void store.refreshSync();
      }
    }
  });

  // Register PWA service worker strictly on web (native Capacitor loads from local bundle)
  if (!isNativePlatform() && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  await hideNativeSplash();
});

onBeforeUnmount(() => {
  teardownValidation?.();
  teardownNative?.();
});
</script>

<template>
  <NuxtPage />
</template>
