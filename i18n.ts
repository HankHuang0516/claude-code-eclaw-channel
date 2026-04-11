/**
 * Lightweight i18n module for EClaw Channel Bridge
 *
 * Supports locale files in ./locales/{locale}.json
 * Uses simple {placeholder} interpolation.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(__dirname, "locales");

type Messages = Record<string, string>;

// ── Load all locale files at startup ──
const locales: Record<string, Messages> = {};

for (const file of readdirSync(LOCALES_DIR)) {
  if (!file.endsWith(".json")) continue;
  const locale = file.replace(".json", "");
  locales[locale] = JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf-8"));
}

// ── Default & active locale ──
const DEFAULT_LOCALE = process.env.DEFAULT_LANGUAGE || "zh-TW";
let activeLocale: string = DEFAULT_LOCALE;

/** Get list of supported locale codes */
export function supportedLocales(): string[] {
  return Object.keys(locales);
}

/** Get the current active locale */
export function getLocale(): string {
  return activeLocale;
}

/** Set the active locale (falls back to default if unsupported) */
export function setLocale(locale: string): void {
  activeLocale = locales[locale] ? locale : DEFAULT_LOCALE;
}

/**
 * Translate a message key with optional interpolation.
 *
 * @param key   - Dot-notation key (e.g. "ask.btn_approve")
 * @param vars  - Interpolation variables (e.g. { tool: "Bash" })
 * @param locale - Override locale for this call (optional)
 * @returns Translated string, or the key itself if not found
 *
 * @example
 *   t("ask.tool_prompt", { tool: "Bash", target: "rm -rf", reason: "cleanup" })
 *   // => "⚠️ Claude 想執行 Bash: rm -rf\n原因: cleanup"
 */
export function t(
  key: string,
  vars?: Record<string, string | number>,
  locale?: string,
): string {
  const loc = locale || activeLocale;
  const messages = locales[loc] || locales[DEFAULT_LOCALE] || {};
  let msg = messages[key];

  // Fallback to default locale, then to key itself
  if (!msg && loc !== DEFAULT_LOCALE) {
    msg = (locales[DEFAULT_LOCALE] || {})[key];
  }
  if (!msg) return key;

  // Interpolate {placeholder} patterns
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }
  }

  return msg;
}

/**
 * Detect language from user message text.
 * Simple heuristic: if message contains mostly CJK characters → zh-TW,
 * otherwise → en-US. Can be extended for more languages.
 */
export function detectLanguage(text: string): string {
  // CJK Unified Ideographs + common CJK punctuation
  const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;
  const cjkCount = (text.match(cjkPattern) || []).length;
  const totalChars = text.replace(/\s/g, "").length || 1;

  if (cjkCount / totalChars > 0.3) return "zh-TW";
  return "en-US";
}
