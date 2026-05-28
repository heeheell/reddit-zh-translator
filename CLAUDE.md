# CLAUDE.md

Reddit ZH Translator — Chrome MV3 扩展，TypeScript + Vite + `@crxjs/vite-plugin`，无后端。

## 开发

```bash
pnpm install
pnpm dev            # 监视构建到 dist/，content/SW HMR
pnpm build          # 一次性构建
pnpm package        # 出 reddit-zh-translator-<version>.zip
```

`chrome://extensions` → 开发者模式 → 加载已解压 → 选 `dist/`。manifest 改动后点扩展的刷新键。

## 配置

点扩展图标打开 popup：选 provider → 填 API key → 保存（自动测试一次）→ 按需调模型 / 预算。Custom provider 切换时会弹 `chrome.permissions.request` 让用户批准 origin。

## 关键代码位置（按腐烂频率从高到低）

- `src/content/shreddit.ts` — **Reddit DOM 选择器**。Reddit 改 Shreddit web components 时第一个挂的就是这里。selectors 集中在 `SEL` 对象。
- `src/content/reply-ui.ts` — **composer 文本注入两路**（execCommand 主路径 / InputEvent 备路径）。execCommand 哪天被 Chrome 移除，注释里那条 InputEvent + composed:true 还能撑一阵。
- `src/background/translate.ts` + `reply.ts` — **system prompt**。译质差先改这里。
- `src/shared/glossary.ts` — subreddit 黑话词典。v1 静态硬编码。

## 已知 DOM 结构（2026-05 实测）

- **shreddit-post**：根节点用 `id="t3_xxx"`（**不是** `thingid` 属性！comments 才用 thingid）。`getThingId()` 在 `shreddit.ts` 同时兼容两路。
- **shreddit-composer 内部 contenteditable**：在 light DOM 里，路径 `shreddit-composer > [slot="rte"] > div[contenteditable="true"][data-lexical-editor="true"][role="textbox"]`。**不在 Shadow DOM 内**。
- **富文本引擎**：Meta **Lexical**。**Lexical 是 anti-XSS 设计——没有任何脚本写入路径能存活它的 reconciler**（2026-05 反复实测确认）：
  - `replaceChildren / insertNode / textContent= / Range.deleteContents+insertNode` —— DOM 改动被 MutationObserver reconciler 在下一个 microtask 撤销。
  - synthetic `InputEvent('beforeinput', {data: chosen})` —— `isTrusted=false`，Lexical 忽略。
  - `document.execCommand('insertText', false, chosen)` —— 触发的 beforeinput 是 `isTrusted=true`，但 Lexical 仍**拦截 + 丢弃**。
  - 任何 fallback 组合都会被 reconciler 累积 → N 倍重复。
  - **Lexical 只信任一种写入**：真实 OS 剪贴板的 paste 事件（isTrusted=true 且经过它自己的事件管道）。

- **当前实现**（`reply-ui.ts:injectIntoComposer`）：自用 + Reddit Lexical 场景下唯一可靠路径——
  1. 候选确认时**立刻 `navigator.clipboard.writeText(chosen)`** 写剪贴板（仍在 user gesture 内）。
  2. **试一发** `execCommand insertText`——若用户某天换到非 Lexical 编辑器或 Reddit 换引擎，这条路自动 work。
  3. 250ms 异步 verify，**失败时弹一个显眼的 toast `✓ 已复制 — 按 ⌘V / Ctrl+V 粘贴`** 浮在 composer 旁，6 秒后自动消失。
  4. textarea 不走这条——它接受 native setter，无 Lexical 干预。

  这不是无缝体验，但是给 Lexical 这种自管理编辑器**唯一可靠的 fallback**。

Reddit 改了 DOM 第一步：在 PDP composer 焦点状态下跑 `document.activeElement` + `document.querySelector('shreddit-composer')` 看结构变化，然后更新 `shreddit.ts` 的 `SEL` 和 `reply-ui.ts` 的 `findEditableTarget` selectors。

## 多 provider

支持 Vercel AI Gateway / OpenAI / DeepSeek / OpenRouter / Custom (OpenAI-compatible)。统一走 `POST {baseUrl}/chat/completions` + Bearer。AI Gateway 走 Anthropic 模型时附 `cache_control` 到消息层级启用 prompt caching。

## 已知脆弱点

- **`document.execCommand("insertText")` 被 deprecate**：备路径 InputEvent 已实现，但 Shreddit 内部不同 composer 表现可能不一致。
- **Shreddit DOM 改版**：选择器表在 `src/content/shreddit.ts` 顶部集中维护。
- **GPT-5 reasoning 系列拒收 `temperature`**：`provider.skipTemperatureFor` 配置表（默认含 `nano` / `o1` / `o3` / `o4`），命中即不传该字段。

