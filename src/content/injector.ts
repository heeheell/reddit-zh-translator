import type { TranslatedItem } from '../shared/messages'

const TR_CLASS = 'rzt-translation'

export function injectTranslations(items: TranslatedItem[], onRetry: (id: string) => void): void {
  for (const it of items) {
    // F10: guard against in-flight DOM removal (collapse, delete, virtualization)
    // Posts use id="t3_xxx", comments use thingid="t1_xxx" — try both.
    const parent =
      document.querySelector(`[thingid="${CSS.escape(it.id)}"]`) ?? document.getElementById(it.id)
    if (!parent) continue
    // De-dup
    const existing = parent.parentElement?.querySelector(`.${TR_CLASS}[data-rzt-id="${it.id}"]`)
    if (existing) existing.remove()

    const node = document.createElement('div')
    node.className = TR_CLASS
    node.setAttribute('data-rzt-id', it.id)

    const badge = document.createElement('span')
    badge.className = 'rzt-badge'
    badge.textContent = it.error ? '!' : '译'
    badge.title = it.error ? '译失败 点击重试' : '点击重新翻译'
    badge.addEventListener('click', () => onRetry(it.id))

    const text = document.createElement('span')
    text.className = 'rzt-text'

    if (it.error === 'budget') {
      text.textContent = '（预算已耗尽，在 popup 调整或重置）'
      node.classList.add('rzt-error')
    } else if (it.error) {
      text.textContent = '译失败 点击重试'
      node.classList.add('rzt-error')
    } else if (it.zh) {
      text.textContent = it.zh
      if (it.degraded) {
        const tag = document.createElement('span')
        tag.className = 'rzt-meta'
        tag.textContent = '（无上下文）'
        text.appendChild(tag)
      }
      if (it.partial) {
        const tag = document.createElement('span')
        tag.className = 'rzt-meta'
        tag.textContent = '（部分恢复）'
        text.appendChild(tag)
      }
    } else {
      text.textContent = '（空）'
    }

    node.appendChild(badge)
    node.appendChild(text)
    parent.insertAdjacentElement('afterend', node)
  }
}

export function removeAllTranslations(): void {
  document.querySelectorAll(`.${TR_CLASS}`).forEach((el) => el.remove())
}

export function showBudgetBanner(totalTok: number, tokIn: number, tokOut: number, budget: number): void {
  let banner = document.getElementById('rzt-budget-banner')
  if (banner) return // already up
  banner = document.createElement('div')
  banner.id = 'rzt-budget-banner'
  banner.textContent = `本会话累计已用 ${totalTok} tok (输入 ${tokIn} + 输出 ${tokOut}) 达预算上限 ${budget}。弹窗里重置或调整预算。`
  document.body.appendChild(banner)
}

export function hideBudgetBanner(): void {
  document.getElementById('rzt-budget-banner')?.remove()
}
