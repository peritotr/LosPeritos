/**
 * The i18n layer. Every piece of interface wording comes from `T`.
 *
 * The language is fixed for the life of the page: changing it reloads the
 * window, so labels built once at module load are never left in the old one.
 * To add a language, copy `locales/en.ts`, translate it, and list it here.
 */
import { en } from "./locales/en";
import { tr } from "./locales/tr";

export type Strings = typeof en;

const LOCALES = { en, tr } satisfies Record<string, Strings>;
export type Language = keyof typeof LOCALES;
export const LANGUAGES: Record<Language, string> = { en: "English", tr: "Türkçe" };

const KEY = "losperitos.lang";

function detect(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in LOCALES) return saved as Language;
  } catch {
    // Storage unavailable: fall through to the system language.
  }
  const system = navigator.language.slice(0, 2).toLowerCase();
  return system in LOCALES ? (system as Language) : "en";
}

export const language: Language = detect();
export const T: Strings = LOCALES[language];
// Lets the browser apply the right casing and hyphenation rules.
document.documentElement.lang = language;

/** BCP 47 tag for dates and numbers. */
export const dateLocale = language === "tr" ? "tr-TR" : "en-GB";

export function setLanguage(next: Language): void {
  if (next === language) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    return;
  }
  location.reload();
}
