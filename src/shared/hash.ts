// djb2 — small, collision rate is fine for our cache key purpose
export function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export function cacheKey(threadKey: string, text: string): string {
  return djb2(`${threadKey}::${text}`)
}
