import type { ProviderConfig } from '../shared/settings'
import type { ThreadContext, TranslateItem, TranslatedItem } from '../shared/messages'
import { getThreadContextRaw } from '../shared/storage'
import { cacheGet, cacheSet } from './cache'
import { cacheKey } from '../shared/hash'
import { callLLMWithRetry, LLMError, type LLMMessage, type LLMResponse } from './llm'
import { recordTranslateUsage, checkBudget } from './budget'
import { glossaryAsPrompt } from '../shared/glossary'

const TRANSLATE_SYSTEM_TEMPLATE = `You are a translator that renders Reddit content into idiomatic Simplified Chinese (Mainland Mandarin).

INPUT FORMAT
The user message is a JSON object: {"items":[{"id":"t1_xxx","text":"...","parent":"optional parent comment text"}]}.

OUTPUT FORMAT
Return ONLY a single JSON object, no prose, no markdown fences:
{"items":[{"id":"t1_xxx","zh":"…"}]}
- Preserve every id, in the same order as the input.
- "zh" must be the natural Chinese rendering.

TRANSLATION DIRECTION
- Any non-Chinese language → Mainland Simplified Chinese.
- Includes English, Japanese, Korean, Spanish, French, German, etc.
- If the input is already mostly Chinese, return it unchanged.

QUALITY RULES
1. Resolve referents with context. When the input uses "this", "that", "they", "the guy", look at parent and post title — translate the referent, not the pronoun. e.g., parent mentions a senator → "this guy" becomes "这位议员", not "这哥们儿".
2. Term consistency. Within one thread, the same noun (product name, person, jargon) must use the same Chinese rendering across all items in this batch.
3. Subreddit register:
   - r/AskHistorians, r/AskScience → formal, precise.
   - r/programmerhumor, r/funny → playful, joke-friendly.
   - r/wallstreetbets → gambler slang via glossary.
   - r/AmItheAsshole, r/relationships → first-person gossip / venting tone.
   - r/AskReddit → conversational, friendly.
   - Default: natural casual Chinese, no translation-ese.
4. Localize Reddit acronyms naturally: ngl→说实话, imo→我觉得, tbh→老实讲, fwiw→姑且一说, lol→哈哈, lmao→笑死, idk→不清楚, OP→楼主, TIL→今天才知道.
5. Forbidden translation-ese: 在此, 于此, 进行 (when used as filler), 让我们.
6. Preserve verbatim: usernames (u/foo), subreddit refs (r/foo), URLs, inline code (\`like_this\`), and fenced code blocks.
7. Sarcasm and tone must survive translation — don't sanitize.`

function buildSystemMessage(ctx: ThreadContext | null): string {
  const ctxBlock = ctx
    ? `\n\nTHREAD CONTEXT
Subreddit: ${ctx.sub}
Post title: ${ctx.postTitle}
Post body (excerpt): ${ctx.postBody}
${Object.keys(ctx.glossary).length > 0 ? `Subreddit glossary (use these renderings): ${glossaryAsPrompt(ctx.glossary)}` : ''}`
    : `\n\n(NO THREAD CONTEXT — translate with general rules only, output will be marked degraded)`
  return TRANSLATE_SYSTEM_TEMPLATE + ctxBlock
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/m

function stripFences(raw: string): string {
  const m = raw.match(FENCE_RE)
  if (m && m[1]) return m[1]
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1)
  }
  return raw
}

// Escape-aware regex fallback: handles \" \\ inside string values
const ITEM_REGEX = /"id"\s*:\s*"(t[13]_[a-z0-9]+)"\s*,\s*"zh"\s*:\s*"((?:[^"\\]|\\.)*)"/g

function unescapeJsonString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === 'r') return '\r'
    return c
  })
}

function regexRecover(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  let m: RegExpExecArray | null
  ITEM_REGEX.lastIndex = 0
  while ((m = ITEM_REGEX.exec(raw)) !== null) {
    if (m[1] && m[2] !== undefined) out[m[1]] = unescapeJsonString(m[2])
  }
  return out
}

function parseTranslateResponse(raw: string): { items: Record<string, string>; ok: boolean } {
  const stripped = stripFences(raw)
  try {
    const parsed = JSON.parse(stripped) as { items?: { id: string; zh: string }[] }
    if (parsed.items && Array.isArray(parsed.items)) {
      const map: Record<string, string> = {}
      for (const it of parsed.items) {
        if (it.id && typeof it.zh === 'string') map[it.id] = it.zh
      }
      return { items: map, ok: true }
    }
  } catch {
    // fall through to regex
  }
  return { items: regexRecover(raw), ok: false }
}

async function callOnce(
  provider: ProviderConfig,
  systemMsg: string,
  items: TranslateItem[],
  temperature: number,
): Promise<LLMResponse> {
  const userPayload = JSON.stringify({
    items: items.map((it) => ({ id: it.id, text: it.text, ...(it.parent ? { parent: it.parent } : {}) })),
  })
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: systemMsg,
      ...(provider.supportsAnthropicCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    },
    { role: 'user', content: userPayload },
  ]
  return callLLMWithRetry(provider, {
    model: provider.modelTranslate,
    messages,
    temperature,
    max_tokens: 1500,
  })
}

async function getThreadContext(threadKey: string, maxWaitMs = 500): Promise<ThreadContext | null> {
  const start = performance.now()
  while (performance.now() - start < maxWaitMs) {
    const ctx = (await getThreadContextRaw(threadKey)) as ThreadContext | undefined
    if (ctx) return ctx
    await new Promise((r) => setTimeout(r, 50))
  }
  return null
}

export async function translateBatch(
  provider: ProviderConfig,
  threadKey: string,
  items: TranslateItem[],
  bypassCache = false,
): Promise<TranslatedItem[]> {
  // Budget gate
  const budget = await checkBudget()
  if (budget.paused) {
    return items.map((it) => ({ id: it.id, error: 'budget' as const }))
  }

  // Cache lookup first
  const cacheLookup = bypassCache
    ? new Map<string, string>()
    : new Map(
        await Promise.all(
          items.map(async (it) => [it.id, await cacheGet(cacheKey(threadKey, it.text))] as const),
        ),
      )

  const needsFetch = items.filter((it) => !cacheLookup.get(it.id))
  const cached: TranslatedItem[] = items
    .filter((it) => cacheLookup.get(it.id))
    .map((it) => ({ id: it.id, zh: cacheLookup.get(it.id)! }))

  if (needsFetch.length === 0) return cached

  // Fetch context (may be null → degraded)
  const ctx = await getThreadContext(threadKey)
  const degraded = ctx === null

  const systemMsg = buildSystemMessage(ctx)

  let response: LLMResponse
  try {
    response = await callOnce(provider, systemMsg, needsFetch, 0.2)
  } catch (e) {
    const kind = (e as LLMError).kind
    const errMap: Record<string, TranslatedItem['error']> = {
      auth: 'auth',
      'rate-limit': 'rate-limit',
      network: 'network',
      server: 'network',
      unknown: 'unknown',
    }
    return [
      ...cached,
      ...needsFetch.map((it) => ({ id: it.id, error: errMap[kind] ?? ('unknown' as const) })),
    ]
  }

  await recordTranslateUsage(response.usage, needsFetch.length)

  const raw = response.choices[0]!.message.content
  let parsed = parseTranslateResponse(raw)
  let recovered = parsed.items
  const missing = needsFetch.filter((it) => !(it.id in recovered))

  // Retry with temperature 0 if anything missing
  if (missing.length > 0) {
    try {
      const retry = await callOnce(provider, systemMsg, missing, 0)
      await recordTranslateUsage(retry.usage, 0) // don't double-count items, but record tokens
      const retryRaw = retry.choices[0]!.message.content
      parsed = parseTranslateResponse(retryRaw)
      recovered = { ...recovered, ...parsed.items }
    } catch {
      // Swallow — items not in recovered get marked error below
    }
  }

  const results: TranslatedItem[] = needsFetch.map((it) => {
    const zh = recovered[it.id]
    if (zh === undefined) {
      return { id: it.id, error: 'parse' as const }
    }
    void cacheSet(cacheKey(threadKey, it.text), zh)
    return {
      id: it.id,
      zh,
      ...(parsed.ok ? {} : { partial: true }),
      ...(degraded ? { degraded: true } : {}),
    }
  })

  return [...cached, ...results]
}
