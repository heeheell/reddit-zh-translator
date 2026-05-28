import { startObserver, resetObserver, flushNow } from './observer'
import { injectTranslations, removeAllTranslations, showBudgetBanner, hideBudgetBanner } from './injector'
import { startReplyUI } from './reply-ui'
import {
  threadKeyFromUrl,
  extractPostTitle,
  extractPostBody,
  getSubredditFromUrl,
  isPdpUrl,
} from './shreddit'
import { glossaryForSub } from '../shared/glossary'
import { getSettings } from '../shared/storage'
import type {
  BroadcastMsg,
  ClientMsg,
  ServerMsg,
  ThreadContext,
  TranslateItem,
  TranslatedItem,
} from '../shared/messages'

let currentThreadKey = threadKeyFromUrl()
let autoTranslateEnabled = true

function getActiveThreadKey(): string {
  return currentThreadKey
}

async function extractAndSendThreadContext(href: string): Promise<void> {
  const sub = getSubredditFromUrl(href)
  if (!sub) return // not on a subreddit page
  // Wait briefly for Shreddit to hydrate post body if we're on a fresh PDP
  await new Promise((r) => setTimeout(r, 100))
  const ctx: ThreadContext = {
    sub,
    postTitle: extractPostTitle(),
    postBody: extractPostBody(),
    glossary: glossaryForSub(sub),
  }
  const threadKey = threadKeyFromUrl(href)
  try {
    await chrome.runtime.sendMessage({
      type: 'SET_THREAD_CTX',
      threadKey,
      ctx,
    } satisfies ClientMsg)
  } catch (e) {
    console.warn('[rzt] SET_THREAD_CTX failed', e)
  }
}

async function onRouteChange(href: string): Promise<void> {
  const newKey = threadKeyFromUrl(href)
  if (newKey === currentThreadKey) return
  currentThreadKey = newKey
  console.log('[rzt] thread context refreshed', newKey)
  removeAllTranslations()
  resetObserver()
  // Re-extract synchronously then start observer
  if (isPdpUrl(href)) {
    await extractAndSendThreadContext(href)
  }
  if (autoTranslateEnabled) {
    startObserver(getActiveThreadKey, dispatchBatch)
  }
}

function dispatchBatch(items: TranslateItem[], threadKey: string): void {
  // Re-check active thread before sending
  if (threadKey !== currentThreadKey) return
  ;(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'TRANSLATE_BATCH',
        threadKey,
        items,
      } satisfies ClientMsg)) as ServerMsg
      if (response.type !== 'TRANSLATE_RESULT') return
      injectTranslations(response.items, (id) => handleRetry(id, items))
    } catch (e) {
      console.warn('[rzt] translate batch failed', e)
    }
  })()
}

function handleRetry(id: string, batchItems: TranslateItem[]): void {
  const orig = batchItems.find((it) => it.id === id)
  if (!orig) return
  ;(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'RETRANSLATE_ONE',
        threadKey: currentThreadKey,
        id,
        text: orig.text,
        kind: orig.kind,
        ...(orig.parent ? { parent: orig.parent } : {}),
      } satisfies ClientMsg)) as ServerMsg
      if (response.type === 'TRANSLATE_RESULT') {
        injectTranslations(response.items, (rid) => handleRetry(rid, batchItems))
      }
    } catch (e) {
      console.warn('[rzt] retry failed', e)
    }
  })()
}

// SPA route detection: Navigation API primary, document.title fallback
function watchRouteChanges(): void {
  // Primary: Navigation API
  const w = window as unknown as {
    navigation?: { addEventListener: (t: string, l: (e: { destination: { url: string }; canIntercept?: boolean }) => void) => void }
  }
  if (w.navigation) {
    w.navigation.addEventListener('navigate', (e) => {
      try {
        const url = new URL(e.destination.url)
        if (url.origin === location.origin) {
          queueMicrotask(() => onRouteChange(url.href))
        }
      } catch {
        // ignore
      }
    })
  }
  // Fallback: <title> mutation observer
  const titleEl = document.querySelector('title')
  if (titleEl) {
    new MutationObserver(() => {
      onRouteChange(location.href)
    }).observe(titleEl, { childList: true, subtree: true, characterData: true })
  }
  // Also catch popstate
  window.addEventListener('popstate', () => onRouteChange(location.href))
}

// SW broadcasts
chrome.runtime.onMessage.addListener((msg) => {
  const m = msg as BroadcastMsg
  if (m.type === 'SETTINGS_CHANGED') {
    ;(async () => {
      const s = await getSettings()
      const wasOn = autoTranslateEnabled
      autoTranslateEnabled = s.autoTranslate
      if (wasOn && !autoTranslateEnabled) {
        removeAllTranslations()
        resetObserver()
      } else if (!wasOn && autoTranslateEnabled) {
        startObserver(getActiveThreadKey, dispatchBatch)
      }
    })()
  } else if (m.type === 'BUDGET_BANNER') {
    showBudgetBanner(m.totalTok, m.tokIn, m.tokOut, m.budget)
  }
})

// Boot
;(async () => {
  const s = await getSettings()
  autoTranslateEnabled = s.autoTranslate

  if (isPdpUrl(location.href)) {
    await extractAndSendThreadContext(location.href)
  } else if (getSubredditFromUrl(location.href)) {
    // Feed page: still extract sub for any post-title items the observer hits
    await extractAndSendThreadContext(location.href)
  }

  watchRouteChanges()
  startReplyUI()

  if (autoTranslateEnabled) {
    startObserver(getActiveThreadKey, dispatchBatch)
  }
})()

// Page unload — flush any pending batch
window.addEventListener('beforeunload', () => flushNow())

// Suppress unused warnings for re-exports kept for future use
void hideBudgetBanner
