import type { ProviderConfig } from '../shared/settings'

export type LLMMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
  cache_control?: { type: 'ephemeral' }
}

export type LLMRequest = {
  model: string
  messages: LLMMessage[]
  temperature?: number
  max_tokens?: number
}

export type LLMUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export type LLMResponse = {
  choices: { message: { content: string }; finish_reason?: string }[]
  usage?: LLMUsage
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate-limit' | 'server' | 'network' | 'unknown',
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message)
  }
}

function shouldSkipTemperature(model: string, skipList?: string[]): boolean {
  if (!skipList || skipList.length === 0) return false
  return skipList.some((sub) => model.toLowerCase().includes(sub.toLowerCase()))
}

export async function callLLM(provider: ProviderConfig, req: LLMRequest): Promise<LLMResponse> {
  if (!provider.apiKey) throw new LLMError('No API key configured', 'auth', false)
  if (!provider.baseUrl) throw new LLMError('No base URL configured', 'auth', false)

  const messages = req.messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content }
    if (provider.supportsAnthropicCache && m.cache_control) {
      out.cache_control = m.cache_control
    }
    return out
  })

  const body: Record<string, unknown> = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens ?? 1500,
  }
  if (req.temperature !== undefined && !shouldSkipTemperature(req.model, provider.skipTemperatureFor)) {
    body.temperature = req.temperature
  }

  let response: Response
  try {
    response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new LLMError(`Network error: ${(e as Error).message}`, 'network', true)
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      throw new LLMError(`Auth failed: ${text.slice(0, 200)}`, 'auth', false, response.status)
    }
    if (response.status === 429 || response.status === 529) {
      throw new LLMError(`Rate limited: ${text.slice(0, 200)}`, 'rate-limit', true, response.status)
    }
    if (response.status >= 500) {
      throw new LLMError(`Server error ${response.status}: ${text.slice(0, 200)}`, 'server', true, response.status)
    }
    throw new LLMError(`HTTP ${response.status}: ${text.slice(0, 200)}`, 'unknown', false, response.status)
  }

  const json = (await response.json()) as LLMResponse
  if (!json.choices?.[0]?.message?.content) {
    throw new LLMError('Malformed response: missing choices[0].message.content', 'unknown', false)
  }
  return json
}

export function extractCacheHitTokens(usage: LLMUsage | undefined): number {
  if (!usage) return 0
  return (usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0)
}

export async function callLLMWithRetry(
  provider: ProviderConfig,
  req: LLMRequest,
  maxRetries = 3,
): Promise<LLMResponse> {
  const delays = [1000, 3000, 7000]
  let lastErr: LLMError | undefined
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await callLLM(provider, req)
    } catch (e) {
      const err = e as LLMError
      lastErr = err
      if (!err.retryable || attempt === maxRetries - 1) throw err
      const delay = delays[attempt] ?? 7000
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr!
}
