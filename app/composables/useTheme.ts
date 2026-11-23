import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { syncNativeStatusBar } from '~/utils/nativeBridge';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // ignore storage access issues
  }
  return 'system';
}

function applyMetaColorScheme(pref: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const content = pref === 'system' ? 'light dark' : pref;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    document.head.appendChild(meta);
  }
  meta.content = content;
}

export function useTheme() {
  const preference = useState<ThemePreference>('krista-mobile-theme', readStoredPreference);
  const systemDark = ref(false);

  const resolvedTheme = computed<'light' | 'dark'>(() =>
    preference.value === 'system' ? (systemDark.value ? 'dark' : 'light') : preference.value
  );

  const setPreference = (next: ThemePreference) => {
    preference.value = next;
    applyMetaColorScheme(next);
    if (typeof window !== 'undefined') {
      try {
        if (next === 'system') {
          window.localStorage.removeItem(STORAGE_KEY);
        } else {
          window.localStorage.setItem(STORAGE_KEY, next);
        }
      } catch {
        // ignore storage errors
      }
      const nextResolved: 'light' | 'dark' =
        next === 'system' ? (systemDark.value ? 'dark' : 'light') : next;
      void syncNativeStatusBar(nextResolved);
    }
  };

  let mql: MediaQueryList | null = null;
  const onMediaChange = (evt: MediaQueryListEvent) => {
    systemDark.value = evt.matches;
    // Per modern-web-guidance dark-mode-toggle: never remove stored override on matchMedia change
    if (preference.value === 'system') {
      void syncNativeStatusBar(evt.matches ? 'dark' : 'light');
    }
  };

  const onStorage = (evt: StorageEvent) => {
    if (evt.key === STORAGE_KEY) {
      const next = readStoredPreference();
      preference.value = next;
      applyMetaColorScheme(next);
    }
  };

  onMounted(() => {
    if (typeof window === 'undefined') return;
    applyMetaColorScheme(preference.value);
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
      systemDark.value = mql.matches;
      mql.addEventListener('change', onMediaChange);
    }
    void syncNativeStatusBar(resolvedTheme.value);
    window.addEventListener('storage', onStorage);
  });

  onBeforeUnmount(() => {
    mql?.removeEventListener('change', onMediaChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  });

  return {
    preference,
    systemDark,
    resolvedTheme,
    setPreference
  };
}
