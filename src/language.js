// language.js — popup 跟設定頁的多語系字典
// HTML 上寫 data-i18n="key"（文字）、data-i18n-placeholder、data-i18n-title，applyLanguage 一次全部換掉，
// 不用再一個 id 一個 id 寫 setText，幹，以前那樣寫到手快斷了
const i18nStrings = {
  en: {
    // 共用
    appName: "CoCo Translate",
    save: "Save",
    delete: "Delete",
    add: "Add",
    export: "Export",
    import: "Import",
    ok: "OK",
    notSet: "Not set",
    needGoogleKey: "Please enter the Google Cloud API key in Sources & AI.",
    needDeepLKey: "Please enter the DeepL API key in Sources & AI.",
    needLlmKey: "Please enter the AI translation API key in Sources & AI.",
    llmPageWarning: "Page translation with AI burns through free quotas quickly. Consider Google / Bing or a local Ollama for page translation.",

    // 語言選項
    langZhTW: "Traditional Chinese",
    langEn: "English",
    langJa: "Japanese",
    langKo: "Korean",

    // 翻譯來源選項
    sourceGoogle: "Google Translate",
    sourceGoogleApi: "Google Cloud API",
    sourceBing: "Bing",
    sourceDeepL: "DeepL API",
    sourceLlm: "AI (LLM)",

    // 外觀
    themeAuto: "Auto",
    themeLight: "Light",
    themeDark: "Dark",
    themeTitleAuto: "Appearance: follow system (click to switch)",
    themeTitleLight: "Appearance: light (click to switch)",
    themeTitleDark: "Appearance: dark (click to switch)",

    // popup
    openSettings: "Settings",
    translatePage: "Translate Page",
    restorePage: "Show Original",
    unsupportedPage: "Can't translate this page",
    displayReplace: "Replace Original",
    displayBilingual: "Bilingual",
    pageSource: "Translation source",
    targetLanguage: "Translate to",
    alwaysTranslate: "Always translate this site",
    mouseTrigger: "Hover translation",
    mouseTriggerHint: "Hold {key} and point at a paragraph",
    youTubeSubtitles: "YouTube subtitles",
    youTubeEnable: "Translate YouTube subtitles",
    youTubeSubtitlesHint: "Turn on CC in the video. YouTube's captions are replaced by one box you can drag. Uses the page translation source.",
    youTubeModeBilingual: "Bilingual",
    youTubeModeTranslation: "Translation",
    glossary: "Glossary",
    vocabulary: "Vocabulary",
    sites: "Sites",
    clearTriggered: "Clear hover translations",

    // 設定頁：導覽
    navGeneral: "General",
    navSources: "Sources & AI",
    navSites: "Sites",
    navGlossary: "Glossary",
    navVocabulary: "Vocabulary",
    navRegex: "Regex",

    // 設定頁：一般
    generalTitle: "General",
    interfaceCard: "Interface",
    uiLanguage: "Interface language",
    appearance: "Appearance",
    appearanceHint: "Auto follows your system's light / dark setting.",
    pageCard: "Page translation",
    displayMode: "Display",
    showOriginalTooltip: "Show original text on hover",
    shortcut: "Keyboard shortcut",
    shortcutHint: "Set or clear it in the browser's shortcut settings.",
    setShortcuts: "Change",
    triggerCard: "Hover translation",
    enableTrigger: "Enable hover translation",
    triggerKey: "Trigger key",
    triggerKeyHint: "Click the box, then press a key.",
    selectionCard: "Selection & input",
    selectionButton: "Toolbar on selected text",
    selectionButtonHint: "Translate, look up words and read aloud.",
    floatingButton: "Translate button in input boxes",
    inputTargetLanguage: "Input boxes translate to",
    contextMenu: "Right-click menu",
    cocoMenu: "CoCo menu only",
    bothMenu: "Both menus",
    defaultMenu: "Browser menu only",
    advancedCard: "Advanced",
    enableCustomRegex: "Apply custom regex to translations",
    useDiskCache: "Keep translations on disk",
    useDiskCacheHint: "Revisited pages load instantly and use less quota.",
    cacheSize: "Cache size: {size}",
    clearCache: "Clear cache",

    // 設定頁：翻譯來源與 AI
    sourcesTitle: "Sources & AI",
    sourcesCard: "Translation sources",
    triggerSource: "Hover & selection translation",
    pageSourceLong: "Page translation & YouTube subtitles",
    sourcesHint: "Google and Bing are free. AI translation sounds more natural but uses up free quotas quickly on whole pages.",
    googleCard: "Google Cloud Translation",
    deepLCard: "DeepL",
    apiKey: "API key",
    apiKeyPlaceholder: "Paste your API key",
    deepLAccountType: "Account type",
    deepLFree: "Free",
    deepLPro: "Pro",
    llmCard: "AI translation (OpenAI compatible)",
    llmProvider: "Provider",
    llmCustom: "Custom (OpenAI compatible)",
    llmOllamaLocal: "Ollama (on this computer)",
    llmBaseUrl: "API base URL",
    llmModel: "Model",
    loadModels: "Load models",
    deleteKey: "Delete key",
    promptCard: "Custom prompts",
    promptHint: "Replaces the default instructions sent to the AI. Leave on \"Default\" unless you need a special style.",
    promptSelect: "Prompt in use",
    promptDefault: "Default",
    promptName: "Name",
    promptNamePlaceholder: "e.g. Wuxia novel",
    promptContent: "Prompt",
    promptContentPlaceholder: "You are a translator…",
    savePrompt: "Save as new prompt",

    // 設定頁：網站
    sitesTitle: "Always Translate These Sites",
    sitesDescription: "Pages on these sites are translated automatically when they open.",
    siteExampleHost: "this domain only (http and https)",
    siteExampleWildcard: "example.com and all its subdomains",
    siteExampleOrigin: "this exact origin",
    siteListEmpty: "No sites yet.",

    // 設定頁：術語表
    glossaryTitle: "Glossary",
    glossaryDescription: "Names and terms that should always be translated the same way — character names, places, sects…",
    glossaryHint: "AI translation gets the glossary in its prompt; Google / Bing / DeepL receive the fixed translation marked as \"do not translate\".",
    glossarySiteHint: "Leave the site empty to use the entry everywhere, or enter a site rule such as *.novel-site.com.",
    glossaryEmpty: "No entries yet.",

    // 設定頁：生字本
    vocabularyTitle: "Vocabulary",
    vocabularyDescription: "Words saved from the word card (select text → 📖). Export them to study in Anki.",
    exportAnki: "Export for Anki",
    clearAll: "Clear all",
    ankiHint: "In Anki: File → Import and choose the exported file. Fields: word, translation, phonetic, context, source.",
    vocabularyEmpty: "No words yet.",

    // 設定頁：正規表達式
    regexTitle: "Regex Patterns",
    regexDescription: "Find-and-replace rules applied to every translation, e.g. to fix names a translator keeps getting wrong.",
    regexEmpty: "No patterns yet.",
    addPattern: "Add pattern",
    importRegexFile: "Import file",
    importRegexHint: "Importing replaces all current patterns.",
    patternInput: "Find (regex)",
    patternOutput: "Replace with"
  },
  zh: {
    appName: "CoCo Translate",
    save: "儲存",
    delete: "刪除",
    add: "新增",
    export: "匯出",
    import: "匯入",
    ok: "好",
    notSet: "未設定",
    needGoogleKey: "請先到「翻譯來源與 AI」填入 Google Cloud API 金鑰。",
    needDeepLKey: "請先到「翻譯來源與 AI」填入 DeepL API 金鑰。",
    needLlmKey: "請先到「翻譯來源與 AI」填入 AI 翻譯的 API 金鑰。",
    llmPageWarning: "用 AI 做整頁翻譯會很快用光免費額度，建議整頁翻譯用 Google / Bing，或改用本機 Ollama。",

    langZhTW: "繁體中文",
    langEn: "英文",
    langJa: "日文",
    langKo: "韓文",

    sourceGoogle: "Google 翻譯",
    sourceGoogleApi: "Google Cloud API",
    sourceBing: "Bing 翻譯",
    sourceDeepL: "DeepL API",
    sourceLlm: "AI 翻譯",

    themeAuto: "自動",
    themeLight: "淺色",
    themeDark: "深色",
    themeTitleAuto: "外觀：跟隨系統（點一下切換）",
    themeTitleLight: "外觀：淺色（點一下切換）",
    themeTitleDark: "外觀：深色（點一下切換）",

    openSettings: "設定",
    translatePage: "翻譯此頁",
    restorePage: "顯示原文",
    unsupportedPage: "這個頁面無法翻譯",
    displayReplace: "取代原文",
    displayBilingual: "雙語對照",
    pageSource: "翻譯來源",
    targetLanguage: "翻譯成",
    alwaysTranslate: "總是翻譯此網站",
    mouseTrigger: "滑鼠觸發翻譯",
    mouseTriggerHint: "按住 {key} 指向段落",
    youTubeSubtitles: "YouTube 字幕",
    youTubeEnable: "翻譯 YouTube 字幕",
    youTubeSubtitlesHint: "影片要開啟 CC 字幕。原本的字幕會換成一個可拖曳的字幕框，使用整頁翻譯的翻譯來源。",
    youTubeModeBilingual: "雙語",
    youTubeModeTranslation: "只譯文",
    glossary: "術語表",
    vocabulary: "生字本",
    sites: "網站清單",
    clearTriggered: "清除觸發譯文",

    navGeneral: "一般",
    navSources: "翻譯來源與 AI",
    navSites: "網站清單",
    navGlossary: "術語表",
    navVocabulary: "生字本",
    navRegex: "正規表達式",

    generalTitle: "一般設定",
    interfaceCard: "介面",
    uiLanguage: "介面語言",
    appearance: "外觀",
    appearanceHint: "「自動」會跟著系統的淺色／深色設定切換。",
    pageCard: "整頁翻譯",
    displayMode: "顯示方式",
    showOriginalTooltip: "滑鼠移到譯文上顯示原文",
    shortcut: "快捷鍵",
    shortcutHint: "到瀏覽器的快捷鍵設定修改或清空。",
    setShortcuts: "修改",
    triggerCard: "滑鼠觸發翻譯",
    enableTrigger: "啟用滑鼠觸發翻譯",
    triggerKey: "觸發鍵",
    triggerKeyHint: "點一下欄位，再按下想用的按鍵。",
    selectionCard: "選取與輸入",
    selectionButton: "選取文字時顯示工具列",
    selectionButtonHint: "翻譯、查單字、朗讀。",
    floatingButton: "輸入框顯示翻譯按鈕",
    inputTargetLanguage: "輸入框翻譯成",
    contextMenu: "右鍵選單",
    cocoMenu: "只顯示可可選單",
    bothMenu: "兩種選單都顯示",
    defaultMenu: "只顯示瀏覽器選單",
    advancedCard: "進階",
    enableCustomRegex: "譯文套用自訂正規表達式",
    useDiskCache: "把譯文存在電腦上",
    useDiskCacheHint: "重看同一頁會直接載入，也比較省額度。",
    cacheSize: "快取大小：{size}",
    clearCache: "清除快取",

    sourcesTitle: "翻譯來源與 AI",
    sourcesCard: "翻譯來源",
    triggerSource: "滑鼠觸發與選取翻譯",
    pageSourceLong: "整頁翻譯與 YouTube 字幕",
    sourcesHint: "Google、Bing 免費；AI 翻譯比較通順，但整頁翻譯會很快用光免費額度。",
    googleCard: "Google Cloud Translation",
    deepLCard: "DeepL",
    apiKey: "API 金鑰",
    apiKeyPlaceholder: "貼上你的 API 金鑰",
    deepLAccountType: "帳戶類型",
    deepLFree: "免費版",
    deepLPro: "Pro 訂閱",
    llmCard: "AI 翻譯（OpenAI 相容）",
    llmProvider: "供應商",
    llmCustom: "自訂（OpenAI 相容）",
    llmOllamaLocal: "Ollama（本機）",
    llmBaseUrl: "API 網址",
    llmModel: "模型",
    loadModels: "載入模型清單",
    deleteKey: "刪除金鑰",
    promptCard: "自訂 Prompt",
    promptHint: "取代預設給 AI 的翻譯指示。沒有特別需求的話，維持「預設」就好。",
    promptSelect: "使用中的 Prompt",
    promptDefault: "預設",
    promptName: "名稱",
    promptNamePlaceholder: "例如：武俠小說",
    promptContent: "Prompt 內容",
    promptContentPlaceholder: "你是一位翻譯……",
    savePrompt: "另存新 Prompt",

    sitesTitle: "總是翻譯的網站",
    sitesDescription: "打開這些網站的網頁時，會自動整頁翻譯。",
    siteExampleHost: "只有這個網域（http、https 都算）",
    siteExampleWildcard: "example.com 和它所有的子網域",
    siteExampleOrigin: "只有這個完整的來源",
    siteListEmpty: "還沒有加入任何網站。",

    glossaryTitle: "術語表",
    glossaryDescription: "每次都要翻成同一個譯名的人名、地名、門派……",
    glossaryHint: "AI 翻譯會把術語表寫進提示；Google / Bing / DeepL 會先把原文換成譯名，並標成不翻譯。",
    glossarySiteHint: "網站留空＝所有網站都套用，也可以填網站規則，例如 *.novel-site.com。",
    glossaryEmpty: "還沒有任何詞條。",

    vocabularyTitle: "生字本",
    vocabularyDescription: "從單字卡收藏的生字（選取文字 → 📖）。可以匯出到 Anki 背單字。",
    exportAnki: "匯出成 Anki 格式",
    clearAll: "全部刪除",
    ankiHint: "在 Anki 選「檔案 → 匯入」，選擇匯出的檔案。欄位：單字、譯文、音標、例句、來源網頁。",
    vocabularyEmpty: "還沒有收藏任何單字。",

    regexTitle: "正規表達式",
    regexDescription: "套用在每一段譯文上的尋找與取代規則，例如修正翻譯老是翻錯的人名。",
    regexEmpty: "還沒有任何規則。",
    addPattern: "新增規則",
    importRegexFile: "匯入檔案",
    importRegexHint: "匯入會覆蓋目前所有的規則。",
    patternInput: "尋找（正規表達式）",
    patternOutput: "取代成"
  }
};

let currentUiLang = 'zh';

/**
 * 取字串；{name} 會換成 params 裡的值
 */
function i18n(key, params = {}) {
  const dict = i18nStrings[currentUiLang] || i18nStrings.en;
  const text = dict[key] ?? i18nStrings.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? params[name] : match));
}

/**
 * 把畫面上所有 data-i18n* 的元素換成指定語言
 */
function applyLanguage(lang) {
  currentUiLang = i18nStrings[lang] ? lang : 'en';
  document.documentElement.lang = currentUiLang === 'zh' ? 'zh-Hant' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = i18n(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = i18n(el.dataset.i18nTitle);
  });
}

/**
 * 讀取當前語言
 */
function getStorageLang() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["myLang"], (res) => {
      resolve(res.myLang);
    });
  });
}

/**
 * 儲存當前語言
 */
function setStorageLang(lang) {
  chrome.storage.local.set({ myLang: lang });
}
