// Patterns that should pass through translation unchanged.
// v1: relies on system prompt instruction to preserve these.
// If the LLM drops them, switch to placeholder substitution layer.
export const URL_RE = /\bhttps?:\/\/[^\s)]+/g
export const USER_REF_RE = /\bu\/[A-Za-z0-9_-]+\b/g
export const SUB_REF_RE = /\br\/[A-Za-z0-9_]+\b/g
export const FENCED_CODE_RE = /```[\s\S]*?```/g
export const INLINE_CODE_RE = /`[^`\n]+`/g
