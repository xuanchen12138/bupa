import { create } from 'zustand';
import type { LocalizedText } from '@bupa/contracts';
import { en, type Dictionary, type DictionaryKey } from './en';
import { zh } from './zh';

export type Locale = 'en' | 'zh';

const dictionaries: Record<Locale, Dictionary> = { en, zh };
const STORAGE_KEY = 'my-bupa-agent.locale';

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch {
    // Storage may be unavailable; fall through to the default.
  }
  return 'en';
}

export const useLocale = create<{ locale: Locale; setLocale: (locale: Locale) => void }>((set) => ({
  locale: readStoredLocale(),
  setLocale: (locale) => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
    set({ locale });
  },
}));

export type Translate = (key: DictionaryKey) => string;

/** Returns `t(key)` for dictionary strings and `tx(localized)` for contract-provided text. */
export function useT() {
  const locale = useLocale((state) => state.locale);
  const dictionary = dictionaries[locale];
  const t: Translate = (key) => dictionary[key] ?? en[key] ?? key;
  const tx = (text: LocalizedText | null | undefined) => (text ? text[locale] : '');
  return { t, tx, locale };
}

export function translate(locale: Locale, key: DictionaryKey) {
  return dictionaries[locale][key] ?? en[key];
}

export type { DictionaryKey };
