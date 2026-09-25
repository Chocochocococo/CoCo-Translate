# 開發說明

## 目錄結構

```
src/                    Chrome 與 Firefox 共用的原始碼
  background.js         背景程式（Chrome = service worker，Firefox = background page）
  translationService.js 翻譯總機：選來源、快取、切批次、錯誤處理
  translator.js         Google / Cloud Translation / Bing / DeepL
  llm.js                AI 翻譯（OpenAI 相容：Ollama Cloud / OpenRouter / Mistral / 本機 Ollama / 自訂）
  markup.js             段落翻譯的行內標記：解析、結構檢查、後處理時保護標籤（前後端共用）
  postprocess.js        自訂正規表達式、引號轉「」、清理 LLM 輸出
  rateLimiter.js        每個翻譯來源的請求佇列（同時請求數、每分鐘請求數）
  translationCache.js   本地快取（IndexedDB，整個擴充功能共用一份）
  content.js            網頁端：滑鼠觸發翻譯、整頁翻譯、輸入框翻譯、右鍵選單
  popup.* / options.*   設定頁面
manifests/
  chrome.json           Chrome（MV3）
  firefox.json          Firefox（MV2）
scripts/build.mjs       打包腳本
tests/                  單元測試與 Chromium 端對端測試
```

版本號只寫在 `package.json`，打包時會自動寫進兩個 manifest。

## 打包

需要 [Node.js](https://nodejs.org/) 18 以上，不用安裝任何套件：

```bash
npm run build            # 兩個都建
npm run build:chrome
npm run build:firefox
```

產出：

- `dist/chrome/`、`dist/firefox/`：可以直接「載入未封裝擴充功能」的資料夾
- `dist/coco-translate-chrome-<版本>.zip`：上傳 Chrome Web Store
- `dist/coco-translate-firefox-<版本>.xpi`：上傳 Firefox Add-ons

沒裝 Node 也沒關係：push 到 GitHub 之後，Actions 會自動跑測試並打包，到該次執行的頁面下載 `coco-translate-packages` 就有 zip 和 xpi。

### 本機測試

- **Chrome**：`chrome://extensions` → 開啟開發人員模式 → 載入未封裝項目 → 選 `dist/chrome`
- **Firefox**：`about:debugging#/runtime/this-firefox` → 載入臨時附加元件 → 選 `dist/firefox/manifest.json`

改完程式碼要重新 `npm run build`，再到擴充功能頁按重新載入。

## 測試

```bash
npm test                               # 單元測試（不需要瀏覽器）
npm run build:chrome && node tests/e2e/chrome.e2e.mjs   # 端對端測試，需要 playwright
```

端對端測試會啟動一個本機的假 AI 伺服器，實際載入擴充功能跑一遍整頁翻譯、觸發式翻譯、輸入框翻譯、錯誤提示和 popup 設定。

## 翻譯流程

```
content.js ──TRANSLATE_BATCH──▶ background.js ─▶ TranslationService
   (找出段落、行內元素換成                        ├─ 記憶體快取 / 本地快取
    <b id="g0">…</b> 送出)
                                                  ├─ 切成適合該來源的批次
                                                  ├─ Provider.translateBatch()（經過 RequestQueue 限流）
                                                  └─ PostProcess（正規表達式、引號）
content.js ◀── { translations, error } ──────────┘
```

content.js 收到譯文後用 `Markup.parse` 解析、`Markup.matchesStructure` 檢查 id 與父子關係，通過才套回原本的節點（`applyUnit`），否則退回逐片段翻（`format: 'text'`）。

新增翻譯來源：在 `translator.js` 或 `llm.js` 實作一個有 `label`、`maxBatchItems`、`maxBatchChars`、`translateBatch(texts, targetLang, sourceLang, { html })` 的類別（`html: true` 時要保留帶 id 的行內標籤），失敗時丟 `TranslationError`，再到 `translationService.js` 的 `createProvider` 加一個 case。

## 本機 Ollama

Ollama 預設就允許瀏覽器擴充功能連線（`chrome-extension://*`、`moz-extension://*`）。如果改過 `OLLAMA_ORIGINS`，記得把這兩個加回去。
