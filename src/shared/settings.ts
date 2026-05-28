import { PROVIDER_PRESETS } from './providers'

export type ProviderConfig = {
  baseUrl: string
  apiKey: string
  modelTranslate: string
  modelReply: string
  supportsAnthropicCache?: boolean
  skipTemperatureFor?: string[]
}

export type Settings = {
  activeProvider: string
  providers: Record<string, ProviderConfig>
  autoTranslate: boolean
  tokenBudget: number
}

export const DEFAULT_SETTINGS: Settings = {
  activeProvider: 'vercel-ai-gateway',
  providers: Object.fromEntries(
    PROVIDER_PRESETS.map((p) => [
      p.name,
      {
        baseUrl: p.baseUrl,
        apiKey: '',
        modelTranslate: p.defaultModelTranslate,
        modelReply: p.defaultModelReply,
        supportsAnthropicCache: p.supportsAnthropicCache,
        skipTemperatureFor: p.skipTemperatureFor,
      },
    ]),
  ),
  autoTranslate: true,
  tokenBudget: 100000,
}
