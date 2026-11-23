import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Clipboard } from '@capacitor/clipboard';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { MobileKeyValueStore } from './mobileVault.ts';

export type RuntimePlatform = 'android' | 'ios' | 'web';

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatformName(): RuntimePlatform {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
  } catch {
    // ignore outside browser/native
  }
  return 'web';
}

/**
 * Storage adapter using `@capacitor/preferences` exclusively on native iOS/Android
 * (never mirroring secrets to WebView localStorage), with one-time migration from
 * legacy localStorage entries. On Web/PWA runtimes, uses `window.localStorage` directly.
 */
export function createCapacitorKeyValueStore(): MobileKeyValueStore {
  return {
    async get(key: string): Promise<string | null> {
      if (isNativePlatform()) {
        try {
          const res = await Preferences.get({ key });
          if (res.value !== null && res.value !== undefined) {
            return res.value;
          }
        } catch {
          // ignore
        }
        // One-time migration from legacy localStorage installs
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            const legacy = window.localStorage.getItem(key);
            if (legacy !== null) {
              await Preferences.set({ key, value: legacy }).catch(() => {});
              window.localStorage.removeItem(key);
              return legacy;
            }
          }
        } catch {
          // ignore migration errors
        }
        return null;
      }

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          return window.localStorage.getItem(key);
        }
      } catch {
        // ignore storage errors
      }
      return null;
    },
    async set(key: string, value: string): Promise<void> {
      if (isNativePlatform()) {
        await Preferences.set({ key, value });
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.removeItem(key);
          }
        } catch {
          // ignore cleanup error
        }
        return;
      }

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        // ignore
      }
    },
    async remove(key: string): Promise<void> {
      if (isNativePlatform()) {
        try {
          await Preferences.remove({ key });
        } catch {
          // ignore
        }
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(key);
        }
      } catch {
        // ignore
      }
    }
  };
}

export async function hapticImpact(kind: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const style =
      kind === 'heavy'
        ? ImpactStyle.Heavy
        : kind === 'medium'
          ? ImpactStyle.Medium
          : ImpactStyle.Light;
    await Haptics.impact({ style });
  } catch {
    // ignore devices without haptic engine
  }
}

export async function hapticNotify(type: 'success' | 'warning' | 'error'): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    const mapped =
      type === 'success'
        ? NotificationType.Success
        : type === 'warning'
          ? NotificationType.Warning
          : NotificationType.Error;
    await Haptics.notification({ type: mapped });
  } catch {
    // ignore
  }
}

function legacyExecCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;inset-block-start:0;opacity:0';
  document.body.append(ta);
  ta.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

let pendingClipboardClearTimer: ReturnType<typeof setTimeout> | null = null;

export async function copyTextNative(text: string): Promise<boolean> {
  if (!text) return false;
  if (isNativePlatform()) {
    try {
      await Clipboard.write({ string: text });
      void hapticImpact('light');
      return true;
    } catch {
      // fallback to web clipboard below
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // try legacy execCommand inside click activation
  }
  return legacyExecCopy(text);
}

/**
 * Copies sensitive secret text (e.g., mnemonic seed phrase) and clears the
 * OS/browser clipboard after `clearAfterMs` (default 45 seconds).
 */
export async function copySensitiveTextNative(
  text: string,
  clearAfterMs = 45_000
): Promise<boolean> {
  const ok = await copyTextNative(text);
  if (!ok) return false;
  if (pendingClipboardClearTimer) {
    clearTimeout(pendingClipboardClearTimer);
    pendingClipboardClearTimer = null;
  }
  if (clearAfterMs > 0) {
    pendingClipboardClearTimer = setTimeout(() => {
      pendingClipboardClearTimer = null;
      if (isNativePlatform()) {
        void Clipboard.write({ string: '' }).catch(() => {});
      } else if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText('').catch(() => {});
      }
    }, clearAfterMs);
  }
  return true;
}

export async function sharePayment(payload: {
  title: string;
  text: string;
  url?: string;
}): Promise<'shared' | 'copied' | 'canceled'> {
  if (isNativePlatform()) {
    try {
      const capCheck = await Share.canShare();
      if (capCheck.value) {
        await Share.share({
          title: payload.title,
          text: payload.text,
          url: payload.url,
          dialogTitle: payload.title
        });
        return 'shared';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      if (msg.includes('cancel')) return 'canceled';
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url
      });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'canceled';
      }
    }
  }

  const fallbackText = payload.url ? `${payload.text}\n${payload.url}` : payload.text;
  const copied = await copyTextNative(fallbackText);
  return copied ? 'copied' : 'canceled';
}

export async function syncNativeStatusBar(resolvedTheme: 'light' | 'dark'): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await StatusBar.setStyle({
      style: resolvedTheme === 'dark' ? Style.Dark : Style.Light
    });
    if (getPlatformName() === 'android') {
      await StatusBar.setBackgroundColor({
        color: resolvedTheme === 'dark' ? '#0b101d' : '#f4f7fc'
      });
    }
  } catch {
    // ignore on platforms without StatusBar
  }
}

export async function hideNativeSplash(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // ignore
  }
}

export interface NativeLifecycleHandlers {
  onBackground?: () => void;
  onResume?: () => void;
  onDeepLink?: (url: string) => void;
  onBackButton?: () => void;
  onNetworkChange?: (online: boolean) => void;
  onKeyboardChange?: (visible: boolean) => void;
}

export function subscribeNativeLifecycle(handlers: NativeLifecycleHandlers): () => void {
  const handles: PluginListenerHandle[] = [];
  let disposed = false;

  const track = (promise: Promise<PluginListenerHandle>) => {
    promise
      .then((h) => {
        if (disposed) {
          void h.remove();
        } else {
          handles.push(h);
        }
      })
      .catch(() => {});
  };

  if (isNativePlatform()) {
    track(
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) handlers.onResume?.();
        else handlers.onBackground?.();
      })
    );
    track(
      App.addListener('appUrlOpen', ({ url }) => {
        if (url) handlers.onDeepLink?.(url);
      })
    );
    track(
      App.addListener('backButton', () => {
        handlers.onBackButton?.();
      })
    );
    track(
      Network.addListener('networkStatusChange', (status) => {
        handlers.onNetworkChange?.(status.connected);
      })
    );
    track(
      Keyboard.addListener('keyboardWillShow', () => {
        if (typeof document !== 'undefined') document.body.classList.add('keyboard-open');
        handlers.onKeyboardChange?.(true);
      })
    );
    track(
      Keyboard.addListener('keyboardWillHide', () => {
        if (typeof document !== 'undefined') document.body.classList.remove('keyboard-open');
        handlers.onKeyboardChange?.(false);
      })
    );

    App.getLaunchUrl()
      .then((res) => {
        if (!disposed && res?.url) {
          handlers.onDeepLink?.(res.url);
        }
      })
      .catch(() => {});
  }

  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') handlers.onBackground?.();
    else if (document.visibilityState === 'visible') handlers.onResume?.();
  };
  const onOnline = () => handlers.onNetworkChange?.(true);
  const onOffline = () => handlers.onNetworkChange?.(false);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  return () => {
    disposed = true;
    for (const h of handles) {
      void h.remove().catch(() => {});
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility);
      document.body.classList.remove('keyboard-open');
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
  };
}
