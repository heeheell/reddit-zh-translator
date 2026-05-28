export type LLMProvider = {
  baseUrl: string
  apiKey: string
  modelTranslate: string
  modelReply: string
  supportsAnthropicCache?: boolean
  skipTemperatureFor?: string[]
}

export type ProviderPreset = {
  name: string
  displayName: string
  baseUrl: string
  defaultModelTranslate: string
  defaultModelReply: string
  supportsAnthropicCache?: boolean
  skipTemperatureFor?: string[]
  customBaseUrl?: boolean
  hostMatchPattern: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    name: 'vercel-ai-gateway',
    displayName: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    defaultModelTranslate: 'anthropic/claude-haiku-4.5',
    defaultModelReply: 'anthropic/claude-sonnet-4.6',
    supportsAnthropicCache: true,
    hostMatchPattern: 'https://ai-gateway.vercel.sh/*',
  },
  {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModelTranslate: 'gpt-5.4-mini',
    defaultModelReply: 'gpt-5.4',
    skipTemperatureFor: ['nano', 'o1', 'o3', 'o4'],
    hostMatchPattern: 'https://api.openai.com/*',
  },
  {
    name: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModelTranslate: 'deepseek-chat',
    defaultModelReply: 'deepseek-chat',
    hostMatchPattern: 'https://api.deepseek.com/*',
  },
  {
    name: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModelTranslate: '',
    defaultModelReply: '',
    hostMatchPattern: 'https://openrouter.ai/*',
  },
  {
    name: 'custom',
    displayName: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    defaultModelTranslate: '',
    defaultModelReply: '',
    customBaseUrl: true,
    hostMatchPattern: '',
  },
]

export function getPreset(name: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.name === name)
}
