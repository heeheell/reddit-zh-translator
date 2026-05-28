import { getStats, updateStats } from '../shared/storage'
import { getSettings } from '../shared/storage'
import type { LLMUsage } from './llm'
import { extractCacheHitTokens } from './llm'

export type BudgetCheck = { paused: boolean; totalTok: number; budget: number }

export async function checkBudget(): Promise<BudgetCheck> {
  const stats = await getStats()
  const settings = await getSettings()
  const total = stats.totalTokIn + stats.totalTokOut
  const paused = total >= settings.tokenBudget
  if (paused !== stats.paused) {
    await updateStats({ paused })
  }
  return { paused, totalTok: total, budget: settings.tokenBudget }
}

export async function recordTranslateUsage(usage: LLMUsage | undefined, itemCount: number): Promise<void> {
  if (!usage) return
  const stats = await getStats()
  await updateStats({
    totalTokIn: stats.totalTokIn + (usage.prompt_tokens ?? 0),
    totalTokOut: stats.totalTokOut + (usage.completion_tokens ?? 0),
    cacheHit: stats.cacheHit + extractCacheHitTokens(usage),
    translatedCount: stats.translatedCount + itemCount,
  })
}

export async function recordReplyUsage(usage: LLMUsage | undefined): Promise<void> {
  if (!usage) return
  const stats = await getStats()
  await updateStats({
    replyCount: stats.replyCount + 1,
    replyTok: stats.replyTok + (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
  })
}

export async function resetStats(): Promise<void> {
  await updateStats({
    totalTokIn: 0,
    totalTokOut: 0,
    cacheHit: 0,
    translatedCount: 0,
    replyCount: 0,
    replyTok: 0,
    paused: false,
  })
}
