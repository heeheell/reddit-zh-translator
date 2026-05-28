export type ThreadContext = {
  sub: string
  postTitle: string
  postBody: string
  glossary: Record<string, string>
}

export type TranslateItem = {
  id: string
  text: string
  kind: 'post-title' | 'post-body' | 'comment'
  parent?: string
}

export type TranslatedItem = {
  id: string
  zh?: string
  partial?: boolean
  degraded?: boolean
  error?: 'parse' | 'network' | 'rate-limit' | 'budget' | 'auth' | 'unknown'
}

export type ReplyCandidate = {
  label: 'conservative' | 'witty' | 'sarcastic'
  text: string
  partial?: boolean
}

export type SessionStats = {
  totalTokIn: number
  totalTokOut: number
  cacheHit: number
  translatedCount: number
  replyCount: number
  replyTok: number
  paused: boolean
}

// eslint-disable-next-line @typescript-eslint/ban-types
type Msg<T extends string, P = {}> = { type: T } & P

export type ClientMsg =
  | Msg<'SET_THREAD_CTX', { threadKey: string; ctx: ThreadContext }>
  | Msg<'TRANSLATE_BATCH', { threadKey: string; items: TranslateItem[] }>
  | Msg<'RETRANSLATE_ONE', { threadKey: string; id: string; text: string; kind: TranslateItem['kind']; parent?: string }>
  | Msg<'REPLY_TRANSFORM', { threadKey: string; text: string; replyingTo?: string }>
  | Msg<'GET_STATS'>
  | Msg<'RESET_STATS'>
  | Msg<'HOTKEY_HANDLED_BY_CONTENT', { ts: number }>
  | Msg<'TEST_PROVIDER', { providerName: string }>

export type ServerMsg =
  | Msg<'TRANSLATE_RESULT', { items: TranslatedItem[] }>
  | Msg<'REPLY_RESULT', { candidates?: ReplyCandidate[]; error?: 'PARSE_FAILED' | 'network' | 'auth' | 'rate-limit' | 'budget'; raw?: string }>
  | Msg<'STATS', SessionStats>
  | Msg<'PROVIDER_TEST_RESULT', { ok: boolean; error?: string }>
  | Msg<'PAUSED_CHANGED', { paused: boolean; reason?: string }>

export type BroadcastMsg =
  | Msg<'TRIGGER_REPLY'>
  | Msg<'SETTINGS_CHANGED'>
  | Msg<'BUDGET_BANNER', { totalTok: number; tokIn: number; tokOut: number; budget: number }>
