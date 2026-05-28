/// <reference types="chrome" />
import type {
  ClientMsg,
  ServerMsg,
  BroadcastMsg,
  TranslatedItem,
  ThreadContext,
} from '../shared/messages'
import { getSettings, getStats, setThreadContextRaw } from '../shared/storage'
import { translateBatch } from './translate'
import { generateReply } from './reply'
import { checkBudget, resetStats } from './budget'
import { callLLM, LLMError } from './llm'

// Hotkey de-dup state (SW-side, 1s cooldown after content handles)
let lastContentHandledTs = 0

// Open session storage to content scripts (avoids needing manual round-trips for stats reads)
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  } catch {
    // Older Chrome may not support; content still has SW round-trip path
  }
})
chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
  } catch {
    // ignore
  }
})

async function getActiveProvider() {
  const settings = await getSettings()
  const provider = settings.providers[settings.activeProvider]
  if (!provider) throw new Error(`Unknown provider: ${settings.activeProvider}`)
  return provider
}

async function broadcastBudgetBanner(): Promise<void> {
  const budget = await checkBudget()
  if (!budget.paused) return
  const stats = await getStats()
  const msg: BroadcastMsg = {
    type: 'BUDGET_BANNER',
    totalTok: budget.totalTok,
    tokIn: stats.totalTokIn,
    tokOut: stats.totalTokOut,
    budget: budget.budget,
  }
  const tabs = await chrome.tabs.query({ url: ['https://www.reddit.com/*', 'https://sh.reddit.com/*'] })
  for (const tab of tabs) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => undefined)
  }
}

chrome.runtime.onMessage.addListener((rawMsg, _sender, sendResponse) => {
  const msg = rawMsg as ClientMsg
  ;(async () => {
    try {
      switch (msg.type) {
        case 'SET_THREAD_CTX': {
          await setThreadContextRaw(msg.threadKey, msg.ctx satisfies ThreadContext)
          sendResponse({ ok: true })
          return
        }
        case 'TRANSLATE_BATCH': {
          const provider = await getActiveProvider()
          const items: TranslatedItem[] = await translateBatch(provider, msg.threadKey, msg.items)
          const response: ServerMsg = { type: 'TRANSLATE_RESULT', items }
          sendResponse(response)
          await broadcastBudgetBanner()
          return
        }
        case 'RETRANSLATE_ONE': {
          const provider = await getActiveProvider()
          const items: TranslatedItem[] = await translateBatch(
            provider,
            msg.threadKey,
            [{ id: msg.id, text: msg.text, kind: msg.kind, ...(msg.parent ? { parent: msg.parent } : {}) }],
            true, // bypassCache
          )
          const response: ServerMsg = { type: 'TRANSLATE_RESULT', items }
          sendResponse(response)
          await broadcastBudgetBanner()
          return
        }
        case 'REPLY_TRANSFORM': {
          const provider = await getActiveProvider()
          const result = await generateReply(provider, msg.threadKey, msg.text, msg.replyingTo)
          const response: ServerMsg = result.ok
            ? { type: 'REPLY_RESULT', candidates: result.candidates }
            : { type: 'REPLY_RESULT', error: result.error, ...(result.raw ? { raw: result.raw } : {}) }
          sendResponse(response)
          return
        }
        case 'GET_STATS': {
          const stats = await getStats()
          const response: ServerMsg = { type: 'STATS', ...stats }
          sendResponse(response)
          return
        }
        case 'RESET_STATS': {
          await resetStats()
          sendResponse({ ok: true })
          return
        }
        case 'HOTKEY_HANDLED_BY_CONTENT': {
          lastContentHandledTs = msg.ts
          sendResponse({ ok: true })
          return
        }
        case 'TEST_PROVIDER': {
          const settings = await getSettings()
          const provider = settings.providers[msg.providerName]
          if (!provider) {
            sendResponse({ type: 'PROVIDER_TEST_RESULT', ok: false, error: 'unknown provider' } satisfies ServerMsg)
            return
          }
          try {
            await callLLM(provider, {
              model: provider.modelTranslate,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 5,
            })
            sendResponse({ type: 'PROVIDER_TEST_RESULT', ok: true } satisfies ServerMsg)
          } catch (e) {
            const err = e as LLMError
            sendResponse({
              type: 'PROVIDER_TEST_RESULT',
              ok: false,
              error: err.message ?? String(e),
            } satisfies ServerMsg)
          }
          return
        }
        default:
          sendResponse({ ok: false, error: 'unknown message type' })
      }
    } catch (e) {
      sendResponse({ ok: false, error: (e as Error).message })
    }
  })()
  return true // async response
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'transform-reply') return
  if (Date.now() - lastContentHandledTs < 1000) return // content already handled
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url?.match(/^https:\/\/(www|sh)\.reddit\.com/)) return
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_REPLY' } satisfies BroadcastMsg).catch(() => undefined)
  }
})

// Settings change broadcast
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return
  ;(async () => {
    const tabs = await chrome.tabs.query({ url: ['https://www.reddit.com/*', 'https://sh.reddit.com/*'] })
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'SETTINGS_CHANGED' } satisfies BroadcastMsg).catch(() => undefined)
    }
  })()
})
