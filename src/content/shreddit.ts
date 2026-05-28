// Reddit DOM selectors — central hub for the "most likely to rot" code.
// When Reddit reshuffles Shreddit web components, update here first.

export const SEL = {
  POST: 'shreddit-post',
  COMMENT: 'shreddit-comment',
  COMPOSER: 'shreddit-composer',
  POST_TITLE: 'shreddit-post [slot="title"], shreddit-post h1',
  POST_BODY: '[id$="-post-rtjson-content"]',
  COMMENT_BODY: '[slot="comment"]',
} as const

export function extractPostTitle(): string {
  const el = document.querySelector<HTMLElement>(SEL.POST_TITLE)
  return el?.textContent?.trim() ?? ''
}

export function extractPostBody(): string {
  const post = document.querySelector(SEL.POST)
  if (!post) return ''
  const body = post.querySelector<HTMLElement>(SEL.POST_BODY)
  return (body?.textContent ?? '').trim().slice(0, 500)
}

export function getSubredditFromUrl(href: string = location.href): string {
  const m = href.match(/\/r\/([^/]+)/)
  return m ? `r/${m[1]}` : ''
}

export function threadKeyFromUrl(href: string = location.href): string {
  // PDP URL minus query and hash
  const url = new URL(href)
  return `${url.origin}${url.pathname}`
}

export function isPdpUrl(href: string = location.href): boolean {
  return /\/r\/[^/]+\/comments\/[^/]+/.test(href)
}

export function getTextFromCommentNode(el: Element): string {
  const body = el.querySelector<HTMLElement>(SEL.COMMENT_BODY)
  return (body?.textContent ?? '').trim()
}

export function getParentText(commentEl: Element): string | undefined {
  const parentId = commentEl.getAttribute('parentid')
  if (!parentId) return undefined
  if (parentId.startsWith('t3_')) return undefined // parent is the post; thread.body already covers it
  const parent = document.querySelector(`shreddit-comment[thingid="${parentId}"]`)
  if (!parent) return undefined
  const text = getTextFromCommentNode(parent)
  return text.slice(0, 200) || undefined
}

export function getThingId(el: Element): string | undefined {
  // shreddit-comment uses `thingid` attribute; shreddit-post uses `id="t3_xxx"` directly.
  return el.getAttribute('thingid') ?? (el.id || undefined)
}

export function getReplyingToFromComposer(composer: Element): string | undefined {
  const comment = composer.closest('shreddit-comment')
  if (!comment) return undefined // PDP top composer
  const body = comment.querySelector<HTMLElement>(SEL.COMMENT_BODY)
  return (body?.textContent ?? '').trim().slice(0, 300) || undefined
}

// Deep query through nested shadow roots — needed for finding the actual
// editable target inside shreddit-composer's potentially multi-layer shadow DOM.
export function deepQuerySelector(root: Element | ShadowRoot, selector: string): Element | null {
  if ('querySelector' in root) {
    const found = (root as ParentNode).querySelector(selector)
    if (found) return found
  }
  const children = (root as Element).children ?? []
  for (const child of Array.from(children)) {
    if (child.shadowRoot) {
      const nested = deepQuerySelector(child.shadowRoot, selector)
      if (nested) return nested
    }
    const inLight = deepQuerySelector(child, selector)
    if (inLight) return inLight
  }
  return null
}
