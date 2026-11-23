import { onBeforeUnmount, onMounted, ref } from 'vue';
import { isNativePlatform } from '~/utils/nativeBridge';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Navigator {
    install?: (options?: { manifest?: string; manifestId?: string }) => Promise<void>;
  }
}

export function usePwaInstall() {
  const canInstall = ref(false);
  const installing = ref(false);
  const installStatus = ref('');

  let deferredInstallPrompt: BeforeInstallPromptEvent | undefined;
  let supportsWebInstall = false;

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    if (!supportsWebInstall) {
      canInstall.value = true;
    }
  };

  const onAppInstalled = () => {
    deferredInstallPrompt = undefined;
    canInstall.value = false;
    installStatus.value = 'KRISTA Wallet PWA installed.';
  };

  onMounted(() => {
    if (typeof window === 'undefined' || isNativePlatform()) {
      canInstall.value = false;
      return;
    }
    supportsWebInstall = typeof Navigator !== 'undefined' && typeof Navigator.prototype.install === 'function';
    if (supportsWebInstall) {
      canInstall.value = true;
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
  });

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    }
  });

  const triggerInstall = async () => {
    if (installing.value || isNativePlatform()) return;
    installing.value = true;

    try {
      if (supportsWebInstall && typeof navigator.install === 'function') {
        await navigator.install();
        installStatus.value = 'The app was installed or opened.';
        canInstall.value = false;
      } else if (deferredInstallPrompt) {
        // Save and discard single-use event before awaiting userChoice (modern-web-guidance: install-web-app)
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = undefined;
        await promptEvent.prompt();
        const { outcome } = await promptEvent.userChoice;
        installStatus.value =
          outcome === 'accepted' ? 'The app was installed.' : 'Installation canceled.';
        if (!deferredInstallPrompt) {
          canInstall.value = false;
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        installStatus.value = 'Installation was canceled or could not complete.';
      } else {
        installStatus.value = 'Installation could not start.';
      }
    } finally {
      installing.value = false;
    }
  };

  return {
    canInstall,
    installing,
    installStatus,
    triggerInstall
  };
}
