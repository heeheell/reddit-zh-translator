import { PROVIDER_PRESETS, getPreset } from '../shared/providers'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { getSettings, setSettings, getStats, DEFAULT_STATS } from '../shared/storage'
import type { ClientMsg, ServerMsg } from '../shared/messages'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el as T
}

const elProvider = $<HTMLSelectElement>('provider')
const elBaseUrl = $<HTMLInputElement>('baseurl')
const elApiKey = $<HTMLInputElement>('apikey')
const elShowKey = $<HTMLButtonElement>('show-key')
const elSaveKey = $<HTMLButtonElement>('save-key')
const elKeyStatus = $<HTMLSpanElement>('key-status')
const elModelTranslate = $<HTMLInputElement>('model-translate')
const elModelReply = $<HTMLInputElement>('model-reply')
const elDlTranslate = $<HTMLDataListElement>('dl-translate')
const elDlReply = $<HTMLDataListElement>('dl-reply')
const elAutoTranslate = $<HTMLInputElement>('auto-translate')
const elBudget = $<HTMLInputElement>('budget')
const elStats = $('stats')
const elResetStats = $<HTMLButtonElement>('reset-stats')

function populateProviders(): void {
  elProvider.innerHTML = ''
  for (const p of PROVIDER_PRESETS) {
    const opt = document.createElement('option')
    opt.value = p.name
    opt.textContent = p.displayName
    elProvider.appendChild(opt)
  }
}

function populateDatalist(dl: HTMLDataListElement, options: string[]): void {
  dl.innerHTML = ''
  for (const o of options) {
    if (!o) continue
    const opt = document.createElement('option')
    opt.value = o
    dl.appendChild(opt)
  }
}

const TRANSLATE_HINTS: Record<string, string[]> = {
  'vercel-ai-gateway': ['anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4.6'],
  openai: ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4'],
  deepseek: ['deepseek-chat'],
  openrouter: ['anthropic/claude-haiku-4.5', 'openai/gpt-5.4-mini', 'deepseek/deepseek-chat'],
}

const REPLY_HINTS: Record<string, string[]> = {
  'vercel-ai-gateway': ['anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4.7'],
  openai: ['gpt-5.4', 'gpt-5.4-mini'],
  deepseek: ['deepseek-chat'],
  openrouter: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4'],
}

async function loadCurrent(): Promise<void> {
  const s = await getSettings()
  populateProviders()
  elProvider.value = s.activeProvider
  applyProvider(s.activeProvider, s)
  elAutoTranslate.checked = s.autoTranslate
  elBudget.value = String(s.tokenBudget)
  void refreshStats()
}

function applyProvider(name: string, settings = DEFAULT_SETTINGS): void {
  const preset = getPreset(name)
  const cfg = settings.providers[name] ?? {
    baseUrl: preset?.baseUrl ?? '',
    apiKey: '',
    modelTranslate: preset?.defaultModelTranslate ?? '',
    modelReply: preset?.defaultModelReply ?? '',
  }
  elBaseUrl.value = cfg.baseUrl
  elBaseUrl.readOnly = !preset?.customBaseUrl
  elApiKey.value = cfg.apiKey
  elApiKey.type = 'password'
  elModelTranslate.value = cfg.modelTranslate
  elModelReply.value = cfg.modelReply
  populateDatalist(elDlTranslate, TRANSLATE_HINTS[name] ?? [])
  populateDatalist(elDlReply, REPLY_HINTS[name] ?? [])
  elKeyStatus.textContent = ''
  elKeyStatus.className = ''
}

async function saveCurrent(): Promise<void> {
  const s = await getSettings()
  const name = elProvider.value
  s.activeProvider = name
  s.providers[name] = {
    baseUrl: elBaseUrl.value.trim().replace(/\/$/, ''),
    apiKey: elApiKey.value.trim(),
    modelTranslate: elModelTranslate.value.trim(),
    modelReply: elModelReply.value.trim(),
    supportsAnthropicCache: getPreset(name)?.supportsAnthropicCache,
    skipTemperatureFor: getPreset(name)?.skipTemperatureFor,
  }
  s.autoTranslate = elAutoTranslate.checked
  s.tokenBudget = Math.max(0, parseInt(elBudget.value, 10) || 100000)
  await setSettings(s)
}

async function requestCustomPermission(baseUrl: string): Promise<boolean> {
  try {
    const url = new URL(baseUrl)
    return await chrome.permissions.request({ origins: [`${url.origin}/*`] })
  } catch {
    return false
  }
}

elProvider.addEventListener('change', async () => {
  const s = await getSettings()
  applyProvider(elProvider.value, s)
})

elShowKey.addEventListener('click', () => {
  elApiKey.type = elApiKey.type === 'password' ? 'text' : 'password'
})

elSaveKey.addEventListener('click', async () => {
  elKeyStatus.textContent = '测试中…'
  elKeyStatus.className = ''
  const preset = getPreset(elProvider.value)
  if (preset?.customBaseUrl && elBaseUrl.value) {
    const granted = await requestCustomPermission(elBaseUrl.value)
    if (!granted) {
      elKeyStatus.textContent = '✗ 未授权该 origin'
      elKeyStatus.className = 'err'
      return
    }
  }
  await saveCurrent()
  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'TEST_PROVIDER',
      providerName: elProvider.value,
    } satisfies ClientMsg)) as ServerMsg
    if (response.type === 'PROVIDER_TEST_RESULT' && response.ok) {
      elKeyStatus.textContent = '✓ 已保存并验证'
      elKeyStatus.className = 'ok'
    } else {
      const errMsg = response.type === 'PROVIDER_TEST_RESULT' ? response.error : 'unknown error'
      elKeyStatus.textContent = '✗ ' + (errMsg ?? '失败')
      elKeyStatus.className = 'err'
    }
  } catch (e) {
    elKeyStatus.textContent = '✗ ' + (e as Error).message
    elKeyStatus.className = 'err'
  }
})

elAutoTranslate.addEventListener('change', () => saveCurrent())
elBudget.addEventListener('change', () => saveCurrent())

elResetStats.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET_STATS' } satisfies ClientMsg)
  void refreshStats()
})

function fmtTok(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

async function refreshStats(): Promise<void> {
  const stats = (await getStats()) ?? DEFAULT_STATS
  elStats.innerHTML = ''
  const rows = [
    `已翻译 <b>${stats.translatedCount}</b> 条 · in <b>${fmtTok(stats.totalTokIn)}</b> · out <b>${fmtTok(stats.totalTokOut)}</b> · cache hit <b>${fmtTok(stats.cacheHit)}</b>`,
    `回帖转译 <b>${stats.replyCount}</b> 次 · ~<b>${fmtTok(stats.replyTok)}</b> tok`,
    stats.paused ? `<span style="color:#c0392b">⚠ 预算已耗尽（paused）</span>` : '',
  ].filter(Boolean)
  elStats.innerHTML = rows.join('<br>')
}

loadCurrent().catch((e) => {
  console.error('[rzt-popup]', e)
})

// Auto-refresh stats every 3s while popup is open
setInterval(() => void refreshStats(), 3000)
