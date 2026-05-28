import type { ProviderConfig } from '../shared/settings'
import type { ReplyCandidate, ThreadContext } from '../shared/messages'
import { getThreadContextRaw } from '../shared/storage'
import { callLLMWithRetry, LLMError, type LLMMessage, type LLMResponse } from './llm'
import { recordReplyUsage } from './budget'
import { glossaryAsPrompt } from '../shared/glossary'

const REPLY_SYSTEM_TEMPLATE = `You are a translation-and-rewriting engine, NOT a chat assistant.

CRITICAL — YOUR ONE JOB:
The user is a Chinese speaker drafting their OWN Reddit comment. draft_zh is their draft in their native language. You render it as a native English Reddit comment. You are their ghost translator.

DO NOT:
- Answer, explain, summarize, or analyze draft_zh.
- Respond to draft_zh as if the user is talking TO you.
- Append the Chinese original, a back-translation, or any bilingual gloss to candidates[].text. ENGLISH ONLY in every text field.
- Add commentary, disclaimers, or meta-discussion.

DO:
- Treat draft_zh as source text to render in English.
- Produce THREE English-only candidates in different tones.
- Sound like an actual Redditor, not a polite ESL student translating word-by-word.

INPUT FORMAT
You receive a JSON object:
{"draft_zh":"…","thread":{"sub":"r/x","title":"…","body":"…","replyingTo":"the comment/post they're replying to"}}

OUTPUT FORMAT
Return ONLY a single JSON object, no prose, no markdown fences, no \`\`\`json:
{"candidates":[{"label":"conservative","text":"…"},{"label":"witty","text":"…"},{"label":"sarcastic","text":"…"}]}
Each "text" is English-only. Exactly three items, exactly these labels, in this order.

REDDIT VOICE — IMPORTANT
Real Redditors don't write like translators. Key tells:
- Lowercase by default. Capital letters only for emphasis or proper nouns.
- Contractions always (don't, can't, won't, gonna, gotta, wanna, lemme, yall).
- Sentence fragments are fine. Run-ons too. Drop unnecessary articles.
- Acronyms: ngl, imo, tbh, fwiw, lol, lmao, idk, iirc, ftfy, smh, ikr, op, eli5.
- Reddit-flavored slang (use sparingly, don't pile them up): lowkey, highkey, literally, fr, fr fr, based, cope, copium, L, W, take, mid, ratio, ymmv, slaps, hits different, this you?, "ok but…", "i mean…", "not gonna lie…".
- Self-deprecation and hedging is native: "idk maybe i'm wrong", "could be me being dumb but…".
- Punctuation is loose — single em-dash or "..." fine, multiple em-dashes is an AI tell.

EXAMPLE INPUT:
{"draft_zh":"这个观点有点道理，但作者忽略了 GIL 问题","thread":{"sub":"r/programming","title":"Why Python is slow","replyingTo":"GC pauses are the main bottleneck."}}

EXAMPLE OUTPUT:
{"candidates":[{"label":"conservative","text":"fair point, but i'd put the GIL above GC pauses here tbh."},{"label":"witty","text":"sure, GC pauses hurt, but the GIL is the final boss nobody wants to fight."},{"label":"sarcastic","text":"yeah totally the GC, definitely not the GIL that's been strangling concurrency since forever lol."}]}

EXAMPLE INPUT 2 (image post, vague question):
{"draft_zh":"图片不太清楚，是单刃还是双刃？说之前我们得先搞清楚这个","thread":{"sub":"r/wicked_edge","title":"is this DE worth fixing?","replyingTo":"anyone got tips on restoring this?"}}

EXAMPLE OUTPUT 2:
{"candidates":[{"label":"conservative","text":"hard to tell from the pic — SE or DE? kinda matters before anyone can give you a real answer."},{"label":"witty","text":"pic's a bit blurry on my end, gotta know if it's SE or DE before we go full restoration nerd mode lol."},{"label":"sarcastic","text":"can't tell SE vs DE from that pic and yet here we are giving advice. classic reddit."}]}

WRITING RULES
1. Respond to thread.replyingTo's specific point — don't write a generic essay.
2. Preserve draft_zh's intent and factual claims. Don't invent details, don't sanitize sarcasm.
3. Subreddit register modulates voice but doesn't override Reddit-native baseline:
   - r/AskHistorians, r/AskScience → fewer acronyms, complete sentences, still casual.
   - r/programmerhumor, r/programming → joke-friendly, tech slang ok.
   - r/wallstreetbets → use gambler glossary heavily (tendies, diamond hands, yolo, etc.).
   - r/AmItheAsshole, r/relationships → first-person, personal-stakes voice.
   - Otherwise: casual internet-native.
4. AVOID AI tells: "I think it's important to note", "As an AI", "Overall", "In conclusion", "It's worth mentioning", em-dash overuse (more than 1), perfectly balanced sentences, "Firstly... Secondly...".
5. Length: match draft_zh within ±30%. Don't pad.
6. Tone gradient — make the three candidates audibly distinct:
   - conservative: polite, hedged, low-slang, safe for any sub. Still Reddit-native (lowercase, contractions), just calmer.
   - witty: dry humor, one clever turn, comfortable with slang. Not mean.
   - sarcastic: bite + meme energy. Slang and self-aware Reddit references welcome. No slurs, no personal attacks.`

function buildReplySystem(ctx: ThreadContext | null): string {
  if (!ctx) return REPLY_SYSTEM_TEMPLATE + '\n\n(NO THREAD CONTEXT AVAILABLE — write generically.)'
  const glossLine = Object.keys(ctx.glossary).length > 0
    ? `\nSubreddit glossary: ${glossaryAsPrompt(ctx.glossary)}`
    : ''
  return `${REPLY_SYSTEM_TEMPLATE}\n\nCURRENT THREAD\nSubreddit: ${ctx.sub}\nPost title: ${ctx.postTitle}\nPost body (excerpt): ${ctx.postBody}${glossLine}`
}

const FENCE_RE = /^```(?:json)?\s*([\s\S]*?)\s*```$/m

function stripFences(raw: string): string {
  const m = raw.match(FENCE_RE)
  if (m && m[1]) return m[1]
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) return raw.slice(first, last + 1)
  return raw
}

const CAND_RE = /"label"\s*:\s*"(conservative|witty|sarcastic)"\s*,\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g

function unescapeJsonString(s: string): string {
  return s.replace(/\\(.)/g, (_, c) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === 'r') return '\r'
    return c
  })
}

function regexRecoverCandidates(raw: string): ReplyCandidate[] {
  const out: ReplyCandidate[] = []
  let m: RegExpExecArray | null
  CAND_RE.lastIndex = 0
  while ((m = CAND_RE.exec(raw)) !== null) {
    if (m[1] && m[2] !== undefined) {
      out.push({
        label: m[1] as ReplyCandidate['label'],
        text: unescapeJsonString(m[2]),
        partial: true,
      })
    }
  }
  return out
}

function parseReplyResponse(raw: string): { candidates: ReplyCandidate[]; ok: boolean } {
  const stripped = stripFences(raw)
  try {
    const parsed = JSON.parse(stripped) as { candidates?: ReplyCandidate[] }
    if (parsed.candidates && Array.isArray(parsed.candidates)) {
      const valid = parsed.candidates.filter(
        (c) =>
          c &&
          typeof c.text === 'string' &&
          c.text.length > 0 &&
          ['conservative', 'witty', 'sarcastic'].includes(c.label),
      )
      if (valid.length > 0) return { candidates: valid, ok: true }
    }
  } catch {
    // fall through
  }
  return { candidates: regexRecoverCandidates(raw), ok: false }
}

async function callReplyOnce(
  provider: ProviderConfig,
  systemMsg: string,
  draftZh: string,
  ctx: ThreadContext | null,
  replyingTo: string | undefined,
  temperature: number,
): Promise<LLMResponse> {
  const userPayload = JSON.stringify({
    draft_zh: draftZh,
    thread: {
      sub: ctx?.sub ?? '',
      title: ctx?.postTitle ?? '',
      body: ctx?.postBody ?? '',
      replyingTo: replyingTo ?? ctx?.postBody ?? '',
    },
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
    model: provider.modelReply,
    messages,
    temperature,
    max_tokens: 800,
  })
}

export type ReplyResult =
  | { ok: true; candidates: ReplyCandidate[] }
  | { ok: false; error: 'PARSE_FAILED' | 'network' | 'auth' | 'rate-limit' | 'budget'; raw?: string }

export async function generateReply(
  provider: ProviderConfig,
  threadKey: string,
  draftZh: string,
  replyingTo: string | undefined,
): Promise<ReplyResult> {
  const ctx = (await getThreadContextRaw(threadKey)) as ThreadContext | undefined
  const systemMsg = buildReplySystem(ctx ?? null)

  let response: LLMResponse
  try {
    response = await callReplyOnce(provider, systemMsg, draftZh, ctx ?? null, replyingTo, 0.85)
  } catch (e) {
    const kind = (e as LLMError).kind
    const map: Record<string, ReplyResult> = {
      auth: { ok: false, error: 'auth' },
      'rate-limit': { ok: false, error: 'rate-limit' },
      network: { ok: false, error: 'network' },
      server: { ok: false, error: 'network' },
      unknown: { ok: false, error: 'network' },
    }
    return map[kind] ?? { ok: false, error: 'network' }
  }

  await recordReplyUsage(response.usage)

  const raw = response.choices[0]!.message.content
  let { candidates, ok } = parseReplyResponse(raw)

  if (candidates.length === 0) {
    // Retry once at temperature 0
    try {
      const retry = await callReplyOnce(provider, systemMsg, draftZh, ctx ?? null, replyingTo, 0)
      await recordReplyUsage(retry.usage)
      const retryRaw = retry.choices[0]!.message.content
      const retryParsed = parseReplyResponse(retryRaw)
      candidates = retryParsed.candidates
      ok = retryParsed.ok
      if (candidates.length === 0) {
        return { ok: false, error: 'PARSE_FAILED', raw: retryRaw.slice(0, 200) }
      }
    } catch {
      return { ok: false, error: 'PARSE_FAILED', raw: raw.slice(0, 200) }
    }
  }

  if (ok && !candidates.some((c) => c.partial)) {
    // Successful parse — no partial flag needed
  } else {
    candidates = candidates.map((c) => ({ ...c, partial: true }))
  }

  return { ok: true, candidates }
}
