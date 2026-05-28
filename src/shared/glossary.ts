// Subreddit-specific slang dictionary. v1 hardcoded for cold start.
// v2 candidate: dynamic collection from "untranslatable" detection.
export const GLOSSARY: Record<string, Record<string, string>> = {
  'r/wallstreetbets': {
    'tendies': '收益',
    'diamond hands': '死扛持仓',
    'paper hands': '割肉跑路',
    'yolo': '梭哈',
    'to the moon': '冲上天',
    'stonks': '股票（戏谑）',
    'autist': '老哥（赌徒自嘲）',
    'fud': '散布恐慌',
    'hodl': '死拿',
    'bagholder': '套牢者',
  },
  'r/programming': {
    'foot-gun': '坑（自踩）',
    'yak shaving': '剃牦牛毛（事情扯远了）',
    'bikeshedding': '抠细枝末节',
    'tech debt': '技术债',
    'greenfield': '新项目',
    'rewrite': '重写',
    'code smell': '代码异味',
  },
  'r/askreddit': {
    'OP': '楼主',
    'TIL': '今天才知道',
    'AMA': '随便问',
    'ELI5': '说人话',
  },
  'r/amitheasshole': {
    'OP': '楼主',
    'AITA': '我是不是混蛋',
    'NTA': '你不是混蛋',
    'YTA': '你才是混蛋',
    'ESH': '都有问题',
    'NAH': '没人有错',
    'INFO': '需要更多信息',
  },
  'r/cscareerquestions': {
    'leetcode': '刷题',
    'TC': '总包',
    'OA': '在线测评',
    'offer': '录用通知',
    'FAANG': '大厂',
    'YOE': '工作年限',
    'WLB': '工作生活平衡',
  },
  'r/relationships': {
    'SO': '对象',
    'ex': '前任',
    'NC': '断联',
    'red flag': '警示信号',
    'gaslight': 'PUA / 心理操控',
  },
}

export function glossaryForSub(sub: string): Record<string, string> {
  const key = sub.toLowerCase()
  return GLOSSARY[key] ?? {}
}

export function glossaryAsPrompt(g: Record<string, string>): string {
  const entries = Object.entries(g)
  if (entries.length === 0) return ''
  return entries.map(([en, zh]) => `${en} = ${zh}`).join('; ')
}
