import { DEFAULT_SETTINGS, type Settings } from './settings'
import type { SessionStats } from './messages'

export const DEFAULT_STATS: SessionStats = {
  totalTokIn: 0,
  totalTokOut: 0,
  cacheHit: 0,
  translatedCount: 0,
  replyCount: 0,
  replyTok: 0,
  paused: false,
}

export async function getSettings(): Promise<Settings> {
  const raw = (await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined
  if (!raw) return structuredClone(DEFAULT_SETTINGS)
  const merged: Settings = { ...DEFAULT_SETTINGS, ...raw }
  merged.providers = { ...DEFAULT_SETTINGS.providers, ...(raw.providers ?? {}) }
  return merged
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s })
}

export async function getStats(): Promise<SessionStats> {
  const raw = (await chrome.storage.session.get('stats')).stats as SessionStats | undefined
  return raw ?? { ...DEFAULT_STATS }
}

export async function setStats(s: SessionStats): Promise<void> {
  await chrome.storage.session.set({ stats: s })
}

export async function updateStats(patch: Partial<SessionStats>): Promise<SessionStats> {
  const current = await getStats()
  const next = { ...current, ...patch }
  await setStats(next)
  return next
}

export async function getThreadContextRaw(threadKey: string): Promise<unknown> {
  return (await chrome.storage.session.get(threadKey))[threadKey]
}

export async function setThreadContextRaw(threadKey: string, ctx: unknown): Promise<void> {
  await chrome.storage.session.set({ [threadKey]: ctx })
}
