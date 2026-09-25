# CoCo Translate 更新計畫（v1.4 草案）

> 掃描基準：`CoCo Translate Chrome/`（v1.3.2.0，MV3）＋ `Coco Translate Firefox/`（v1.3.2.0，MV2）
> 撰寫日期：2026-09-25

---

## 0. 現況總覽

| 項目 | 狀態 |
|---|---|
| Chrome 版原始碼 | 在 repo 內，約 4,100 行，無建置流程、無測試 |
| Firefox 版原始碼 | 已放進 repo，內容與 `v1.3.2.0.xpi` 完全一致（只差換行字元 CRLF/LF）。與 Chrome 版的**實質差異很小**，見下表 |
| 翻譯來源 | Google（免金鑰）、Cloud Translation、Bing（Edge token）、DeepL、Mistral |
| Mistral | 2026-09-03 起免費 Experiment 方案不再附每月約 10 億 token 的 API 額度，改為另購 API 點數 → 目前等於不能免費用 |


### Chrome 版 vs Firefox 版實際差異

把 `browser.*` 換成 `chrome.*` 之後再比對，真正不同的只有這幾處：

| 項目 | Chrome | Firefox |
|---|---|---|
| Manifest | MV3，service worker | MV2，常駐 background page |
| 圖示 API | `chrome.action` | `browser.browserAction` |
| 右鍵選單 | 只在 `onInstalled` 建立 | 另外在 `onStartup` 重建（修正重開瀏覽器選單消失） |
| Regex 匯入 | popup 內直接開檔案選擇器 | 開 `options.html`（Firefox popup 開檔案對話框時會自己關掉） |
| content scripts | **多注入了 `popup.js`**（見 2-9） | 沒有 |
| translationCache.js | 多了幾個註解掉的函式 | — |

`content.js`、`translator.js` 除了命名空間以外**一模一樣**，所以合併成單一原始碼的成本很低。

---

## 1. Bug 清單（依嚴重度）

### 🔴 P0：「總是翻譯此網站」壞掉的根本原因

**1-1. 自動整頁翻譯跟翻譯器初始化發生 race condition**
`content.js:1152` 讀取 `siteTranslationList` 後立刻呼叫 `translatePage()`，但 `pageTranslator` 要等到 `content.js:1183` 另一個 `storage.get` 回呼才建立（Cloud / DeepL 還要再多一層回呼）。
Chrome 會依呼叫順序回傳，所以自動翻譯執行時 `pageTranslator` 幾乎一定是 `undefined`：

- `pageTranslator.translate(...)` 丟出 TypeError，整頁翻譯靜默失敗
- 但 `isPageTranslationMode` 已經被設成 `true` → 滑鼠觸發翻譯、選取按鈕全部失效，頁面卡在一種「沒翻譯卻又是翻譯模式」的狀態

**1-2. 自動翻譯不會通知背景頁**
自動啟動時沒有送 `TRANSLATE_PAGE` 給 background，右鍵選單仍顯示「Page Translate」而不是「Restore Page」，按下去會重複翻譯。

**1-3. 勾選當下不會生效、只比對 origin**
- 在 popup 勾選後，目前分頁不會馬上翻譯，要重新整理才會
- 只用 `location.origin` 比對：`https://a.example.com` 和 `https://b.example.com` 算兩個站；也沒有辦法在 popup 以外檢視或管理清單

### 🔴 P0：設定變更傳不到頁面

`popup.js` 用 `chrome.runtime.sendMessage` 送出 `UPDATE_TRIGGER_TRANSLATION_SOURCE`、`UPDATE_PAGE_TRANSLATION_SOURCE`、`UPDATE_SELECTION_BUTTON`、`UPDATE_SHOW_ORIGINAL_TOOLTIP`、`TOGGLE_FLOATING_BUTTON`，**這些訊息只會送到 background，不會送到 content script**，background 也沒有轉發。
→ 換翻譯來源、開關按鈕，都要重新整理頁面才生效。

### 🟠 P1：功能性錯誤

| # | 位置 | 問題 |
|---|---|---|
| 2-1 | `background.js:34-39` | 任何不是 `GET_TAB_ID` 的訊息都會先 `sendResponse({tabId:null})` 並印出錯誤，導致後面 `ADD_SITE_TRANSLATION` 的回應永遠送不出去，console 也一直噴錯 |
| 2-2 | `background.js` | MV3 service worker 會休眠，`pageTranslationStatus` 放在記憶體裡會消失 → 右鍵選單狀態錯亂。應改存 `chrome.storage.session` |
| 2-3 | `translationCache.js` | **IndexedDB 在 content script 裡使用的是「網頁的 origin」**，所以每個網站各自一份快取；popup 讀到的是擴充功能自己的 DB（永遠是空的）。這就是「快取大小」不準、「清除快取」只能改成連到 Notion 說明頁的原因 |
| 2-4 | `content.js:380-413` | 整頁翻譯對每個文字節點同時發一個請求（`Promise.all`），大頁面會瞬間打出上千個請求 → 被 Google/Bing 限流。Bing 路徑甚至沒走 `limitedFetch` |
| 2-5 | `content.js:222-235` | Mistral 用 `|||---DELIM---|||` 分隔符拼接，模型一旦吃掉或多吐一個分隔符，後面所有段落就錯位 |
| 2-6 | `translator.js:324` | Content-Type 打成 `application/application/json+protobuf` |
| 2-7 | Firefox `background.js` 有 `onStartup` 重建右鍵選單的修正，Chrome 版沒有 |
| 2-8 | `content.js` 多處 | `translateBtn` 未宣告（隱式全域）、`popup.js:349` 的 `enableSelectionButton` 也是 |
| 2-9 | Chrome `manifest.json:29` | content scripts 清單裡多了 `popup.js`，每個網頁都會多載入一份 popup 的程式碼（實測它的 `DOMContentLoaded` 回呼沒有執行，所以沒造成錯誤，純粹是多餘的負擔）。content.js 沒有用到它，直接拿掉 |

### 🟡 P2：安全與品質

- `popup.js:397` 把 regex 規則直接塞進 `innerHTML`，匯入惡意 JSON 會造成 HTML injection；`showCustomWarning` 同理 → 改用 `textContent` / DOM API
- 五個 Translator class 有大量重複（快取、引號轉換、regex 後處理各寫五次）
- console 訊息的「他媽的」風格：**保留，這是特色** 🫡
- 沒有 lint、沒有自動化測試、沒有打包腳本；`Coco Translate v1.3.2.0.xpi` 二進位檔直接 commit 在 repo

---

## ✅ Phase 1 完成紀錄（v1.3.3.0）

Chrome、Firefox 兩邊同步修改。

| 問題 | 修法 |
|---|---|
| 1-1 自動翻譯 race condition | 翻譯器改由 `loadTranslators()` 一次讀齊設定後建立，所有翻譯入口都先 `await translatorsReady` |
| 1-2 自動翻譯沒通知背景頁 | 自動翻譯時送 `TRANSLATE_PAGE`；頁面載入時送 `CONTENT_READY` 重設狀態 |
| 1-3 勾選後要重新整理 | 勾選當下直接翻譯、取消勾選直接還原；`chrome://` 等頁面停用勾選框 |
| 設定傳不到頁面 | content script 改聽 `storage.onChanged`：翻譯來源、API key、目標語言、觸發鍵、各種按鈕開關都即時生效 |
| 2-1 背景頁訊息處理 | 移除錯誤的 else 分支；`SET_TARGET_LANGUAGE` 原本會被 tabId 檢查擋掉，一併修正 |
| 2-2 選單狀態消失 | Chrome 存 `storage.session`；選單只反映「目前分頁」，切換視窗也會更新 |
| 2-6 Content-Type 打錯 | 改成 `application/json+protobuf` |
| 2-7 `onStartup` 重建選單 | 兩邊都有了，並先 `removeAll()` 避免重複 id |
| 2-8 隱式全域變數 | 補上宣告 |
| 2-9 多注入 popup.js | 從 Chrome manifest 移除 |

額外修掉的：

- **更新擴充功能會把目標語言重設成 zh-TW、翻譯重新開啟**：`onInstalled` 改成只補上缺少的設定
- **DeepL Pro 帳號設定沒有作用**：原本建立 `DeepLTranslator` 時沒有傳入帳號類型，永遠打 free 端點
- 瀏覽器重開後，停用狀態的圖示會變回啟用圖示
- 懸浮按鈕關掉再打開，不會再重複掛上點擊監聽器

測試：在 Chromium 載入擴充功能，用假的 Google 翻譯回應做端對端測試。舊版重現 `Cannot read properties of undefined (reading 'translate')`；新版的自動翻譯、選單狀態、設定即時生效、popup 勾選和取消勾選都通過。Firefox 版沒辦法在測試環境執行，改用比對確認兩邊的修改一致，**仍需要在 Firefox 實機測一次**。

---

## 2. 新的 AI 翻譯來源

### 方向：一個通用的「OpenAI 相容」翻譯器，取代各家分開寫

Ollama Cloud、OpenRouter、Mistral、Groq、本機 Ollama、LM Studio 都支援 `/v1/chat/completions`，只要做一個 `OpenAICompatibleTranslator`，用「預設供應商 + 自訂」的方式設定即可：

| 預設供應商 | Base URL | 備註 |
|---|---|---|
| **Ollama Cloud** | `https://ollama.com/v1` | 免費方案可用 `gemma4:31b` 等 starter 模型；每月額度、同時只能 1 個請求（**必須序列化**） |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `:free` 模型每分鐘 20 次；每天 50 次（累計儲值 ≥ $10 可升到 1,000 次）。要帶 `HTTP-Referer` / `X-Title` header |
| Mistral | `https://api.mistral.ai/v1` | 保留給已付費的使用者 |
| 本機 Ollama | `http://localhost:11434/v1` | 完全免費、無限制；需設定 `OLLAMA_ORIGINS` 允許擴充功能來源 |
| 自訂 | 使用者自填 | 任何相容端點 |

設定欄位：供應商、API Key、模型名稱（可從 `/v1/models` 抓清單讓使用者選）、每分鐘請求數上限、同時請求數、temperature。

> ⚠️ 免費額度很容易用完。以 OpenRouter 免費帳號每天 50 次來算，**LLM 只適合「觸發式翻譯」與「輸入框翻譯」**；整頁翻譯預設仍用 Google/Bing，除非使用者自己改成本機 Ollama。

### 分段格式改良（取代分隔符）

改成要求模型回傳 JSON：

```text
輸入：{"segments": ["段落1", "段落2", ...]}
輸出：{"segments": ["譯文1", "譯文2", ...]}
```

- 支援 `response_format: {type: "json_object"}` 的供應商就開啟
- 回傳長度不符時自動退回「逐段翻譯」，不會整批錯位
- 移除 Mistral 專屬的 `prefix: true` assistant 訊息（其他供應商不支援）

### 保留並強化的功能

- 自訂 prompt（現有 `${fullTargetLang}` 變數保留，新增 `${sourceLang}`）
- 語言全名對照表補齊（目前只有 en/ja/ko/zh）
- 錯誤訊息顯示在頁面上（429 額度用完、401 金鑰錯誤），不再只印 console 然後回傳原文

---

## 3. 架構調整

### 3-1. 翻譯請求移到 background service worker

目前 API 呼叫都在 content script 裡，搬到 background 後：

- 快取（IndexedDB）只有一份，快取大小／清除快取可以正常運作 → 解決 2-3
- 全域統一限流（每個供應商一個佇列），不會因為開了 10 個分頁就打出 10 倍請求 → 解決 2-4、Ollama Cloud 同時 1 請求的限制
- API Key 不再進入網頁環境
- 不受網頁 CSP 影響

content script 只負責收集文字、送 `TRANSLATE_BATCH` 訊息、把結果放回 DOM。

### 3-2. 設定同步改用 `chrome.storage.onChanged`

content script 監聽 storage 變化自行更新，popup 只要寫 storage，不必廣播訊息 → 解決 P0 設定不生效問題，也順便讓多個分頁同步。

### 3-3. 整頁翻譯批次化

- 收集可見區域文字節點 → 每批約 50 段或 5,000 字 → 一次送出
- 用 `IntersectionObserver` 只翻譯進入畫面的段落（省額度）
- Google `translateHtml` 本身就支援陣列輸入，一次請求可翻多段

### 3-4. 單一原始碼、雙瀏覽器建置

```
src/                 共用原始碼
manifests/
  chrome.json        MV3
  firefox.json       MV3（Firefox 128+ 已支援 MV3，background 用 scripts）
scripts/build.mjs    產出 dist/chrome/、dist/firefox/ 與 zip/xpi
```

- 統一用 `chrome.*` API（Firefox 也支援 `chrome` 命名空間），`content.js`／`translator.js` 可直接共用
- 把 Firefox 版的 `onStartup` 選單修正合併到兩邊；Regex 匯入兩邊都改走 options 頁（Chrome 也適用，還能順便當網站清單管理頁）
- `.xpi` 從 repo 移除，改放 GitHub Releases
- 加 ESLint；翻譯器核心（分段、解析、引號轉換）寫單元測試

---

## 4. 分階段執行

| 階段 | 內容 | 預估規模 | 版本 |
|---|---|---|---|
| **Phase 1：修 Bug** | 1-1～1-3「總是翻譯此網站」、設定不生效（改 `storage.onChanged`）、2-1、2-2、2-6～2-9；Chrome、Firefox 兩個資料夾同步修 | 小，約 1～2 天 | v1.3.3 |
| **Phase 2：重整結構** | 兩版合併成單一 `src/`、建置腳本、翻譯請求移到 background、統一快取與限流、Translator 抽共用基底 | 中 | v1.4.0 |
| **Phase 3：新 AI 來源** | `OpenAICompatibleTranslator`、Ollama Cloud / OpenRouter / 本機 Ollama 預設、模型清單、JSON 分段、錯誤提示 UI | 中 | v1.4.0 |
| **Phase 4：整頁翻譯效能** | 批次化、只翻可見區域、SPA 換頁偵測 | 中 | v1.5.0 |
| **Phase 5：打磨** | 安全修正（innerHTML）、網站清單管理頁（支援萬用字元 `*.example.com`）、README／Notion 文件更新 | 小 | v1.5.x |

建議順序：**先做 Phase 1**（馬上能用、風險低），再把 Phase 2 + 3 一起做，因為新的 AI 來源最好直接建立在 background 架構上，不用寫兩次。

---

## 5. 待決定事項

1. Firefox 版要不要一起升到 MV3？（Firefox 128+ 支援，可以共用 manifest 結構）
2. 整頁翻譯要不要開放使用 LLM？（建議只開放給本機 Ollama／自訂端點，並顯示額度警告）
3. Mistral 要保留成獨立選項，還是併入「OpenAI 相容」的預設清單？（建議併入）
4. 現有使用者的 `mistralApiKey` 設定要自動遷移到新結構嗎？（建議要）

---

參考資料：
- [Ollama Cloud 免費方案與 Gemma 4 31B](https://www.ayautomate.com/free-models/ollama-cloud-gemma4-31b)、[Ollama Cloud free tier](https://itsfree.ai/provider/ollama-cloud/)
- [OpenRouter 免費模型限制](https://openrouter.zendesk.com/hc/en-us/articles/39501163636379-OpenRouter-Rate-Limits-What-You-Need-to-Know)、[OpenRouter FAQ](https://openrouter.ai/docs/faq)
- [Mistral 免費方案 2026 變更](https://agentdeals.dev/vendor/mistral-ai)
