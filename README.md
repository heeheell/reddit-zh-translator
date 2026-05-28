# Reddit ZH Translator

一个把 Reddit 翻译成中文 + 把中文回帖转成符合社区文化的英文的 Chrome 扩展。

- 滚到视野的英文（以及其它非中文）帖子/评论 → 自动翻成中文，双语对照展示
- 写中文回复 → 按 `⌘⇧E` / `Ctrl+Shift+E` → 3 个候选英文（保守 / 幽默 / 讽刺）
- 上下文感知翻译——结合 subreddit、帖子标题、父评论、社区黑话词典
- 多 LLM provider 抽象，支持 Vercel AI Gateway / OpenAI / DeepSeek / OpenRouter / 自填端点（OpenAI-compatible）
- 自用本地扩展，无后端，API key 存浏览器本地

## 截图

> （留位置：装好扩展后跑一遍，截两张图——feed 的双语对照 + 回帖候选面板——传到 `docs/` 里替换这两行）

## 装载

不打算上 Chrome Web Store（自用为主，且 `optional_host_permissions: ["*://*/*"]` 会触发审核问题）。**开发者模式加载已解压**即可：

```bash
git clone <your-fork>
cd reddit-zh-translator
pnpm install
pnpm build
```

1. 打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压**，选项目根目录的 `dist/` 文件夹
4. 点扩展图标打开 popup → 选 provider → 填 API key → 保存

## 用法

**阅读模式**（自动）：去 `https://www.reddit.com/` 任意 subreddit，滚动。视野内的帖子/评论会在原文下方插入"译"badge + 中文译文。`r/China_irl` 等中文为主的子版自动跳过不翻。

**回帖模式**（手动）：

1. 点 Reply 打开 composer
2. 中文写你想发的内容
3. 按 `⌘⇧E`（Mac）或 `Ctrl+Shift+E`（Win/Linux），或点 composer 旁的小 "译→英" chip
4. 等 2-3 秒，浮出 3 个候选英文版本（保守 / 幽默 / 讽刺）
5. 点"用这个" → 译文进剪贴板 + 显示提示 "✓ 已复制 — 按 ⌘V 粘贴" → 在 composer 按 `⌘V` 完成粘贴
6. 手动微调 → 点 Reddit 原生 "Comment" 按钮发出

> 为什么"用这个"不直接覆盖 composer 而是要按 ⌘V？Reddit 用 Meta Lexical 编辑器，它的 reconciler 拦截一切脚本写入（trusted execCommand 也拦），只接受真实 OS 剪贴板粘贴。所以扩展自动写剪贴板，由你的真实按键完成最后一步。详见 `CLAUDE.md` 的踩坑笔记。

## 支持的 LLM Provider

| Provider | 翻译默认 | 回帖默认 | Prompt Caching |
|---|---|---|---|
| Vercel AI Gateway | `anthropic/claude-haiku-4.5` | `anthropic/claude-sonnet-4.6` | ✓（Anthropic 模型） |
| OpenAI | `gpt-5.4-mini` | `gpt-5.4` | 隐式 |
| DeepSeek | `deepseek-chat` | `deepseek-chat` | — |
| OpenRouter | 自填 | 自填 | 看模型 |
| Custom | 自填 base URL + model | — | 看实现 |

切 provider 时 popup 会自动测试 key 是否生效（绿勾/红叉）。

回帖的语气质量对小模型（DeepSeek）有上限——想要更地道的 Reddit 风格英文，用 Claude Sonnet 4.6 或 GPT-5.4。

## 配置项

popup 里能调：

- **Provider**：5 个内置 + custom
- **API Key**：本地存 `chrome.storage.local`，永远不会发出本机以外（除了发给你选的 provider）
- **翻译模型 / 回帖模型**：每个 provider 独立
- **自动翻译开关**：关掉时清除页面所有已注入译文 + 停 observer
- **Token 预算**：会话累计 in+out tokens 上限（默认 100K），达到后停翻译并显示 banner，回帖转译不受此限
- **会话统计**：`已翻译 N 条 · in/out/cache hit tokens · 回帖 N 次`，浏览器关闭即清

## 数据流

```
原文（你浏览器里的 Reddit DOM）
   ↓ content script 抽取
   ↓ chrome.runtime.sendMessage
service worker（你浏览器后台）
   ↓ HTTPS POST
你选的 LLM provider（OpenAI / DeepSeek / 等）
   ↓ HTTPS 响应
service worker
   ↓ chrome.runtime.sendMessage
content script
   ↓
译文注入回 Reddit DOM（双语对照展示）
```

扩展不收集、不上报任何数据，没有任何第三方分析。源码读完即可验证。

## 已知限制 / 不打算做

- **Lexical composer 注入需要手按 ⌘V**：见上文，Reddit 编辑器的 anti-XSS 设计，所有脚本写入都被拒。`execCommand("insertText")` 也不行。
- **不支持 old.reddit.com**：DOM 结构完全不同，未做适配
- **不算钱**：popup 显示 token 数不显示成本估算（定价表会腐烂，自己算）
- **glossary 是静态硬编码**：6 个 subreddit 各 5-15 词，过期就过期

## 隐私

API key 存 `chrome.storage.local`，不离开你的浏览器（除了发给你自己选的 provider 走 HTTPS）。如果你担心 provider 拿到你的 Reddit 浏览记录，切 custom + 自建 OpenAI-compatible 端点。

## 贡献

PR 欢迎，但优先级是"修腐烂的 selectors"——Reddit 改 Shreddit web component 名字时 `src/content/shreddit.ts` 是第一个挂的地方。

新功能/v2 想法见项目 issues 或 `CLAUDE.md` 末尾的 v2 候选清单。

## 设计文档

完整设计 + 反复审计迭代记录在 `/Users/xbinao/.claude/plans/3-reddit-llm-api-reddit-bubbly-wilkes.md`（本地路径，没放进 repo）。开发踩坑笔记在 `CLAUDE.md`。

## License

MIT
