import { SEL, getThingId, getTextFromCommentNode, getParentText } from './shreddit'
import { isMostlyChineseText, tooShortToTranslate } from '../shared/cjk'
import type { TranslateItem } from '../shared/messages'

type Pending = {
  el: WeakRef<Element>
  id: string
  text: string
  kind: TranslateItem['kind']
  parent?: string
}

const seen = new WeakSet<Element>()
let stack: Pending[] = []
let batchTimer: number | null = null
let batchThreadKey: string | null = null
let intersectionObs: IntersectionObserver | null = null
let mutationObs: MutationObserver | null = null
let activeThreadKeyGetter: (() => string) | null = null
let flushCallback: ((items: TranslateItem[], threadKey: string) => void) | null = null

const BATCH_WINDOW_MS = 150
const BATCH_MAX_ITEMS = 8
const BATCH_MAX_CHARS = 3000

function flush(): void {
  if (batchTimer !== null) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
  if (stack.length === 0 || !batchThreadKey || !flushCallback) {
    stack = []
    batchThreadKey = null
    return
  }
  // F8: drop the batch if user has navigated away
  if (activeThreadKeyGetter && batchThreadKey !== activeThreadKeyGetter()) {
    stack = []
    batchThreadKey = null
    return
  }
  const items: TranslateItem[] = stack
    .map((p) => {
      const el = p.el.deref()
      if (!el || !el.isConnected) return null
      return {
        id: p.id,
        text: p.text,
        kind: p.kind,
        ...(p.parent ? { parent: p.parent } : {}),
      }
    })
    .filter((x): x is TranslateItem => x !== null)
  const tk = batchThreadKey
  stack = []
  batchThreadKey = null
  if (items.length > 0) flushCallback(items, tk)
}

function schedule(): void {
  if (batchTimer !== null) return
  batchTimer = setTimeout(flush, BATCH_WINDOW_MS) as unknown as number
}

function enqueue(el: Element, kind: TranslateItem['kind']): void {
  if (!activeThreadKeyGetter) return
  if (seen.has(el)) return
  let text = ''
  let parent: string | undefined
  if (kind === 'comment') {
    text = getTextFromCommentNode(el)
    parent = getParentText(el)
  } else if (kind === 'post-body') {
    const body = el.querySelector<HTMLElement>(SEL.POST_BODY)
    text = (body?.textContent ?? '').trim()
  } else if (kind === 'post-title') {
    const title = el.querySelector<HTMLElement>('[slot="title"]') ?? el.querySelector('h1')
    text = (title?.textContent ?? '').trim()
  }
  if (!text) return
  if (tooShortToTranslate(text)) return
  if (isMostlyChineseText(text)) return
  const id = getThingId(el)
  if (!id) return
  seen.add(el)

  const currentTk = activeThreadKeyGetter()
  if (batchThreadKey && batchThreadKey !== currentTk) {
    // thread changed mid-batch — drop and restart
    stack = []
  }
  batchThreadKey = currentTk
  stack.push({ el: new WeakRef(el), id, text, kind, ...(parent ? { parent } : {}) })

  const totalChars = stack.reduce((sum, p) => sum + p.text.length, 0)
  if (stack.length >= BATCH_MAX_ITEMS || totalChars >= BATCH_MAX_CHARS) {
    flush()
  } else {
    schedule()
  }
}

function tryRegister(el: Element): void {
  if (seen.has(el)) return
  if (!intersectionObs) return
  intersectionObs.observe(el)
}

function walkNew(node: Node): void {
  if (!(node instanceof Element)) return
  if (node.matches(SEL.COMMENT) || node.matches(SEL.POST)) tryRegister(node)
  node.querySelectorAll(`${SEL.COMMENT}, ${SEL.POST}`).forEach(tryRegister)
}

export function startObserver(
  getActiveThreadKey: () => string,
  onBatchReady: (items: TranslateItem[], threadKey: string) => void,
): void {
  activeThreadKeyGetter = getActiveThreadKey
  flushCallback = onBatchReady

  intersectionObs = new IntersectionObserver(
    (entries) => {
      // LIFO: push to stack in order, flush pops from end → newest visible first
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target
        intersectionObs?.unobserve(el)
        if (el.matches(SEL.COMMENT)) {
          enqueue(el, 'comment')
        } else if (el.matches(SEL.POST)) {
          // post → enqueue title AND body separately if they have content
          enqueue(el, 'post-title')
          enqueue(el, 'post-body')
        }
      }
    },
    { rootMargin: '200px 0px', threshold: 0.01 },
  )

  // Initial scan
  document.querySelectorAll(`${SEL.COMMENT}, ${SEL.POST}`).forEach(tryRegister)

  mutationObs = new MutationObserver((muts) => {
    const idle = (cb: () => void) =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 200 }) : setTimeout(cb, 0)
    idle(() => {
      for (const m of muts) {
        for (const n of Array.from(m.addedNodes)) walkNew(n)
      }
    })
  })
  mutationObs.observe(document.body, { childList: true, subtree: true })
}

export function resetObserver(): void {
  if (mutationObs) {
    mutationObs.disconnect()
    mutationObs = null
  }
  if (intersectionObs) {
    intersectionObs.disconnect()
    intersectionObs = null
  }
  stack = []
  batchThreadKey = null
  if (batchTimer !== null) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}

export function flushNow(): void {
  flush()
}

export function popStack(): Pending[] {
  // LIFO pop helper if we ever want to drain in newest-first order
  const out: Pending[] = []
  while (stack.length > 0) {
    const item = stack.pop()
    if (item) out.push(item)
  }
  return out
}
