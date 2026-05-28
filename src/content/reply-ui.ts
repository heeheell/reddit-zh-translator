import { SEL, getReplyingToFromComposer, deepQuerySelector, threadKeyFromUrl } from './shreddit'
import type { ClientMsg, ReplyCandidate, ServerMsg } from '../shared/messages'

let lastFocusedComposer: WeakRef<Element> | null = null
let chip: HTMLElement | null = null
let panel: HTMLElement | null = null

function ensureChip(near: Element): void {
  if (chip) chip.remove()
  chip = document.createElement('div')
  chip.id = 'rzt-chip'
  chip.textContent = '译→英 (⌘⇧E)'
  chip.title = '把你的中文草稿转成 Reddit 英文（3 个候选）'
  chip.addEventListener('click', () => triggerTransform())
  document.body.appendChild(chip)
  positionChip(near)
}

function positionChip(near: Element): void {
  if (!chip) return
  const rect = near.getBoundingClientRect()
  chip.style.position = 'fixed'
  chip.style.top = `${Math.max(8, rect.top - 32)}px`
  chip.style.left = `${rect.left}px`
  chip.style.zIndex = '999999'
}

function dismissChip(): void {
  chip?.remove()
  chip = null
}

function setSpinnerOnChip(): void {
  if (chip) chip.textContent = '生成中…'
}

function clearSpinner(): void {
  if (chip) chip.textContent = '译→英 (⌘⇧E)'
}

function closePanel(): void {
  panel?.remove()
  panel = null
}

const LABEL_ZH: Record<ReplyCandidate['label'], string> = {
  conservative: '保守',
  witty: '幽默',
  sarcastic: '讽刺',
}

function showCandidatesPanel(composer: Element, candidates: ReplyCandidate[]): void {
  closePanel()
  panel = document.createElement('div')
  panel.id = 'rzt-panel'

  const rect = composer.getBoundingClientRect()
  panel.style.position = 'fixed'
  panel.style.top = `${Math.max(8, rect.top - 8)}px`
  panel.style.left = `${rect.left}px`
  panel.style.width = `${Math.max(360, rect.width)}px`
  panel.style.zIndex = '999998'

  for (const c of candidates) {
    const card = document.createElement('div')
    card.className = 'rzt-card'
    const head = document.createElement('div')
    head.className = 'rzt-card-head'
    const label = document.createElement('span')
    label.className = 'rzt-card-label'
    label.textContent = LABEL_ZH[c.label]
    head.appendChild(label)
    if (c.partial) {
      const tag = document.createElement('span')
      tag.className = 'rzt-meta'
      tag.textContent = '（部分恢复）'
      head.appendChild(tag)
    }
    const useBtn = document.createElement('button')
    useBtn.className = 'rzt-card-use'
    useBtn.textContent = '用这个'
    useBtn.type = 'button'
    // Critical: prevent button from stealing focus from the composer.
    // Without this, mousedown moves focus to the button, then click runs
    // execCommand against the wrong selection — first attempt silently fails.
    useBtn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // Eagerly re-focus the composer so injection happens against a known-focused target.
      ;(composer as HTMLElement).focus()
    })
    useBtn.addEventListener('click', () => {
      injectIntoComposer(composer, c.text)
      closePanel()
    })
    const copyBtn = document.createElement('button')
    copyBtn.className = 'rzt-card-copy'
    copyBtn.textContent = '复制'
    copyBtn.type = 'button'
    copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
    copyBtn.addEventListener('click', () => navigator.clipboard.writeText(c.text).catch(() => undefined))
    head.appendChild(useBtn)
    head.appendChild(copyBtn)
    card.appendChild(head)
    const body = document.createElement('div')
    body.className = 'rzt-card-text'
    body.textContent = c.text
    card.appendChild(body)
    panel.appendChild(card)
  }

  const close = document.createElement('button')
  close.className = 'rzt-panel-close'
  close.textContent = '关闭'
  close.addEventListener('click', closePanel)
  panel.appendChild(close)

  document.body.appendChild(panel)

  // Esc to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closePanel()
      document.removeEventListener('keydown', onKey)
    }
  }
  document.addEventListener('keydown', onKey)
}

function showPanelError(composer: Element, message: string, raw?: string): void {
  closePanel()
  panel = document.createElement('div')
  panel.id = 'rzt-panel'
  const rect = composer.getBoundingClientRect()
  panel.style.position = 'fixed'
  panel.style.top = `${Math.max(8, rect.top - 8)}px`
  panel.style.left = `${rect.left}px`
  panel.style.width = `${Math.max(360, rect.width)}px`
  panel.style.zIndex = '999998'
  const msg = document.createElement('div')
  msg.className = 'rzt-card-text'
  msg.textContent = message
  panel.appendChild(msg)
  if (raw) {
    const pre = document.createElement('pre')
    pre.className = 'rzt-raw'
    pre.textContent = raw
    panel.appendChild(pre)
  }
  const close = document.createElement('button')
  close.className = 'rzt-panel-close'
  close.textContent = '关闭'
  close.addEventListener('click', closePanel)
  panel.appendChild(close)
  document.body.appendChild(panel)
}

function readComposerText(composer: Element): string {
  const editable = deepQuerySelector(composer, '[contenteditable="true"], textarea')
  if (!editable) return ''
  if (editable instanceof HTMLTextAreaElement) return editable.value
  return (editable.textContent ?? '').trim()
}

function findEditableTarget(composer: Element): HTMLElement | null {
  // Try a series of editor selectors, broadest to narrowest
  const selectors = [
    '[contenteditable="true"]',
    '[contenteditable=""]',
    '[contenteditable]:not([contenteditable="false"])',
    'textarea',
    '[role="textbox"]',
  ]
  for (const sel of selectors) {
    const el = deepQuerySelector(composer, sel) as HTMLElement | null
    if (el) {
      console.log('[rzt] composer target found via', sel, el)
      return el
    }
  }
  console.warn('[rzt] no editable target inside composer; composer outerHTML head:', composer.outerHTML.slice(0, 300))
  return null
}

function dispatchInputEvents(target: HTMLElement | HTMLTextAreaElement, data: string): void {
  target.dispatchEvent(
    new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      data,
      inputType: 'insertText',
    }),
  )
  target.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data,
      inputType: 'insertText',
    }),
  )
  target.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}

function selectAllIn(target: HTMLElement): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(target)
  sel.removeAllRanges()
  sel.addRange(range)
}

function showPasteHint(composer: Element, message: string): void {
  document.getElementById('rzt-paste-hint')?.remove()
  const hint = document.createElement('div')
  hint.id = 'rzt-paste-hint'
  hint.textContent = message
  const rect = composer.getBoundingClientRect()
  hint.style.cssText = [
    'position:fixed',
    `top:${Math.max(8, rect.top - 40)}px`,
    `left:${rect.left}px`,
    'z-index:999999',
    'background:#d4a017',
    'color:white',
    'padding:8px 14px',
    'border-radius:4px',
    'font-size:13px',
    'font-family:system-ui,sans-serif',
    'font-weight:600',
    'box-shadow:0 2px 8px rgba(0,0,0,0.2)',
    'cursor:pointer',
    'user-select:none',
  ].join(';')
  hint.addEventListener('click', () => hint.remove())
  document.body.appendChild(hint)
  setTimeout(() => hint.remove(), 8000)
}

function injectIntoComposer(composer: Element, chosen: string): void {
  const target = findEditableTarget(composer)
  if (!target) {
    console.error('[rzt] no editable target; outerHTML head:', composer.outerHTML.slice(0, 300))
    return
  }

  // <textarea> path — works fine, native setter bypasses framework interceptors.
  if (target instanceof HTMLTextAreaElement) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    target.focus()
    nativeSetter?.call(target, chosen) ?? (target.value = chosen)
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
    console.log('[rzt] injected via textarea native setter')
    return
  }

  // contenteditable path. Reddit uses Lexical, which has an anti-XSS posture:
  //   - It owns the DOM via MutationObserver; external mutations get reverted.
  //   - synthetic InputEvent (isTrusted=false) is ignored.
  //   - Even browser-trusted execCommand("insertText") beforeinput is intercepted
  //     and discarded (verified 2026-05 against r/wicked_edge composer).
  //
  // Conclusion: there is no programmatic write path into a Lexical contenteditable
  // that survives Lexical's reconciler in a content-script context. The only
  // user-input path Lexical *does* trust is a REAL paste from the OS clipboard.
  //
  // Strategy:
  //   1. Always write `chosen` to the clipboard NOW (we're in a user-gesture).
  //   2. Try execCommand("insertText") for non-Lexical contenteditables anyway.
  //   3. Async-verify 250ms later. If text didn't commit, show a prominent
  //      "✓ 已复制 — 按 ⌘V 粘贴" hint near the composer. User pastes manually
  //      → real OS clipboard paste → isTrusted=true → Lexical accepts.
  void navigator.clipboard
    .writeText(chosen)
    .then(() => console.log('[rzt] clipboard primed with chosen text'))
    .catch((e) => console.warn('[rzt] clipboard write failed:', e))

  target.focus()
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(target)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  let ok = false
  try {
    ok = document.execCommand('insertText', false, chosen)
  } catch (e) {
    console.warn('[rzt] execCommand threw', e)
  }
  console.log('[rzt] execCommand insertText fired, returned=' + ok)

  setTimeout(() => {
    const tc = target.textContent ?? ''
    const head = chosen.slice(0, Math.min(20, chosen.length))
    if (tc.includes(head)) {
      console.log('[rzt] ✓ direct injection committed')
    } else {
      console.warn('[rzt] direct injection rejected by editor (Lexical); falling back to clipboard hint')
      showPasteHint(composer, '✓ 已复制 — 按 ⌘V / Ctrl+V 粘贴')
    }
  }, 250)
}

async function triggerTransform(): Promise<void> {
  const composer = lastFocusedComposer?.deref() ?? document.querySelector(SEL.COMPOSER)
  if (!composer) {
    console.warn('[rzt] no composer found for hotkey')
    return
  }
  const text = readComposerText(composer).trim()
  if (!text) {
    console.warn('[rzt] composer is empty')
    return
  }
  setSpinnerOnChip()

  const replyingTo = getReplyingToFromComposer(composer)
  const msg: ClientMsg = {
    type: 'REPLY_TRANSFORM',
    text,
    threadKey: threadKeyFromUrl(),
    ...(replyingTo ? { replyingTo } : {}),
  }

  try {
    const response = (await chrome.runtime.sendMessage(msg)) as ServerMsg
    clearSpinner()
    if (response.type !== 'REPLY_RESULT') return
    if (response.error) {
      const errMsg: Record<string, string> = {
        PARSE_FAILED: 'AI 输出格式错误，可手动复制原文使用',
        network: '网络错误，重试一下',
        auth: 'API key 无效，去 popup 检查',
        'rate-limit': '触发限流，稍等再试',
        budget: '本会话预算已耗尽，去 popup 重置或调整',
      }
      showPanelError(composer, errMsg[response.error] ?? '出错了', response.raw)
      return
    }
    if (response.candidates && response.candidates.length > 0) {
      showCandidatesPanel(composer, response.candidates)
    }
  } catch (e) {
    clearSpinner()
    showPanelError(composer, '与扩展通信失败：' + (e as Error).message)
  }
}

export function startReplyUI(): void {
  document.addEventListener('focusin', (e) => {
    const target = e.target as Element
    const composer = target.closest(SEL.COMPOSER)
    if (composer) {
      lastFocusedComposer = new WeakRef(composer)
      ensureChip(composer)
    }
  })

  document.addEventListener('focusout', (e) => {
    const target = e.target as Element
    if (target.closest(SEL.COMPOSER)) {
      // Delay dismissal so re-focus doesn't flicker the chip
      setTimeout(() => {
        const active = document.activeElement
        if (!active || !active.closest(SEL.COMPOSER)) dismissChip()
      }, 200)
    }
  })

  // Hotkey: ⌘⇧E / Ctrl+Shift+E — content-side primary handler
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    if (!e.shiftKey) return
    if (e.key !== 'E' && e.key !== 'e') return
    e.preventDefault()
    // Tell SW we handled it so the parallel commands.onCommand path doesn't double-fire
    chrome.runtime
      .sendMessage({ type: 'HOTKEY_HANDLED_BY_CONTENT', ts: Date.now() } satisfies ClientMsg)
      .catch(() => undefined)
    triggerTransform()
  })

  // SW broadcast: chrome.commands fired but content didn't claim → trigger here
  chrome.runtime.onMessage.addListener((msg) => {
    if ((msg as { type?: string }).type === 'TRIGGER_REPLY') {
      triggerTransform()
    }
  })
}
