import { defineManifest } from '@crxjs/vite-plugin'
import pkg from '../package.json' with { type: 'json' }

export default defineManifest({
  manifest_version: 3,
  name: 'Reddit ZH Translator',
  version: pkg.version,
  description: 'Read Reddit in Chinese, reply in Reddit-style English.',
  permissions: ['storage'],
  host_permissions: [
    'https://ai-gateway.vercel.sh/*',
    'https://api.openai.com/*',
    'https://api.deepseek.com/*',
    'https://openrouter.ai/*',
    'https://api.anthropic.com/*',
    'https://www.reddit.com/*',
    'https://sh.reddit.com/*',
  ],
  optional_host_permissions: ['*://*/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['https://www.reddit.com/*', 'https://sh.reddit.com/*'],
      js: ['src/content/index.ts'],
      css: ['src/content/styles.css'],
      run_at: 'document_idle',
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Reddit ZH Translator',
  },
  commands: {
    'transform-reply': {
      suggested_key: { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' },
      description: 'Transform Chinese draft into Reddit-style English',
    },
  },
  icons: {
    '16': 'src/icons/16.png',
    '48': 'src/icons/48.png',
    '128': 'src/icons/128.png',
  },
})
