import {
  GLOSSARY_LANGUAGES,
  sanitizeGlossaryLanguage,
  translateMobileUi,
  type GlossaryLanguage,
  type MobileUiKey
} from '~/utils/mobileI18n';
import { createCapacitorKeyValueStore } from '~/utils/nativeBridge';

const LOCALE_KEY = 'krista_mobile_locale_v1';

function detectInitialLocale(): GlossaryLanguage {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(LOCALE_KEY);
      if (saved) return sanitizeGlossaryLanguage(saved, 'tr');
    } catch {
      // ignore
    }
    if (typeof navigator !== 'undefined' && navigator.language) {
      return sanitizeGlossaryLanguage(navigator.language.split('-')[0], 'tr');
    }
  }
  return 'tr';
}

export function useWalletI18n() {
  const locale = useState<GlossaryLanguage>('krista-mobile-locale', detectInitialLocale);
  const store = createCapacitorKeyValueStore();

  const hydrateLocale = async () => {
    const saved = await store.get(LOCALE_KEY);
    if (saved) {
      const safe = sanitizeGlossaryLanguage(saved, 'tr');
      locale.value = safe;
      if (typeof document !== 'undefined') {
        document.documentElement.lang = safe;
      }
    }
  };

  const setLocale = (next: string) => {
    const safe = sanitizeGlossaryLanguage(next, 'tr');
    locale.value = safe;
    if (typeof document !== 'undefined') {
      document.documentElement.lang = safe;
    }
    void store.set(LOCALE_KEY, safe);
  };

  const t = (key: MobileUiKey, vars?: Record<string, string | number>): string =>
    translateMobileUi(locale.value, key, vars);

  return {
    locale,
    languages: GLOSSARY_LANGUAGES,
    hydrateLocale,
    setLocale,
    t
  };
}
