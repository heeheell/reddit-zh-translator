const MEM_CAP = 2000
const DISK_CAP = 500
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const STORE_KEY = 'tcache'

type Entry = { zh: string; ts: number }
type DiskBlob = Record<string, Entry>

const mem = new Map<string, Entry>()
let dirty = false
let writeTimer: number | null = null

async function loadFromDisk(): Promise<void> {
  const raw = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY] as DiskBlob | undefined
  if (!raw) return
  const now = Date.now()
  for (const [k, v] of Object.entries(raw)) {
    if (now - v.ts < TTL_MS) mem.set(k, v)
  }
}

let initPromise: Promise<void> | null = null
function ensureLoaded(): Promise<void> {
  if (!initPromise) initPromise = loadFromDisk()
  return initPromise
}

function scheduleFlush(): void {
  if (writeTimer !== null) return
  dirty = true
  writeTimer = setTimeout(flushNow, 5000) as unknown as number
}

async function flushNow(): Promise<void> {
  writeTimer = null
  if (!dirty) return
  dirty = false
  const entries = [...mem.entries()]
  entries.sort((a, b) => b[1].ts - a[1].ts) // newest first
  const trimmed = entries.slice(0, DISK_CAP)
  const blob: DiskBlob = Object.fromEntries(trimmed)
  await chrome.storage.local.set({ [STORE_KEY]: blob })
}

export async function cacheGet(key: string): Promise<string | undefined> {
  await ensureLoaded()
  const e = mem.get(key)
  if (!e) return undefined
  if (Date.now() - e.ts > TTL_MS) {
    mem.delete(key)
    return undefined
  }
  // LRU touch: re-insert to move to end
  mem.delete(key)
  mem.set(key, e)
  return e.zh
}

export async function cacheSet(key: string, zh: string): Promise<void> {
  await ensureLoaded()
  mem.set(key, { zh, ts: Date.now() })
  if (mem.size > MEM_CAP) {
    const oldest = mem.keys().next().value
    if (oldest) mem.delete(oldest)
  }
  scheduleFlush()
}
