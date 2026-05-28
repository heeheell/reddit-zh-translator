// Skip texts that are already mostly Chinese.
// Range covers CJK Unified Ideographs (U+4E00–U+9FFF), CJK symbols/punctuation,
// fullwidth forms, plus whitespace and any Unicode punctuation.
// Hiragana/Katakana/Hangul are intentionally NOT included — those should be translated.
const CHINESE_DOMINANT = /^[一-鿿　-〿＀-￯\s\p{P}]+$/u

export function isMostlyChineseText(text: string): boolean {
  return CHINESE_DOMINANT.test(text)
}

export function tooShortToTranslate(text: string): boolean {
  return text.trim().length < 8
}
