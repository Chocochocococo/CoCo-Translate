// background.js — Chrome（MV3 service worker）與 Firefox（MV2 background page）共用
// Firefox 的 manifest 會先載入下面這些檔案；Chrome 的 service worker 要自己 importScripts
const BACKGROUND_LIBS = [
  'translationCache.js',
  'markup.js',
  'postprocess.js',
  'rateLimiter.js',
  'translator.js',
  'llm.js',
  'translationService.js'
];
if (typeof importScripts === 'function') {
  importScripts(...BACKGROUND_LIBS);
}

const DEFAULT_SETTINGS = { targetLanguage: 'zh-TW', isEnabled: true };

// Chrome MV3 叫 action，Firefox MV2 叫 browserAction
const actionApi = chrome.action || chrome.browserAction;

// 包一層 promise，兩個瀏覽器的 chrome.* 都吃 callback，這樣寫最保險
const storageGet = keys => new Promise(resolve => chrome.storage.local.get(keys, data => resolve(data || {})));
const storageSet = items => new Promise(resolve => chrome.storage.local.set(items, () => resolve()));
const queryTabs = query => new Promise(resolve => chrome.tabs.query(query, tabs => resolve(tabs || [])));

const MENU_ITEMS = [
  { id: "translate-selection", title: "Selection Translate", contexts: ["selection"] },
  { id: "clear-all-translations", title: "Clear Translations", contexts: ["all"] },
  { id: "translate-page", title: "Page Translate", contexts: ["all"] }
];

// 先清空再建立，避免 onInstalled / onStartup 重複建立時噴 duplicate id
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    MENU_ITEMS.forEach(item => chrome.contextMenus.create(item));
  });
}

const updateActionIcon = (isEnabled) => {
  actionApi.setIcon({
    path: { 48: isEnabled ? "icons/icon-48.png" : "icons/icon-disabled-48.png" }
  });
};

// 舊版的 Mistral 設定搬到新的 llmSettings（只搬一次）
const migrateSettings = async () => {
  const data = await storageGet(['llmSettings', 'mistralApiKey', 'triggerTranslationSource', 'pageTranslationSource']);
  const updates = {};
  if (!data.llmSettings && data.mistralApiKey) {
    updates.llmSettings = TranslationService.normalizeLLMSettings(data);
  }
  if (data.triggerTranslationSource === 'mistral-api') updates.triggerTranslationSource = 'llm';
  if (data.pageTranslationSource === 'mistral-api') updates.pageTranslationSource = 'google';
  if (Object.keys(updates).length) await storageSet(updates);
};

chrome.runtime.onInstalled.addListener(async () => {
  createContextMenus();
  // 只補上還沒設定過的值，更新擴充功能時別他媽把使用者的設定洗掉
  const data = await storageGet(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (data[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) await storageSet(missing);
  updateActionIcon(data.isEnabled ?? DEFAULT_SETTINGS.isEnabled);
  await migrateSettings();
});

// 為了解決 Firefox 重啟後右鍵選單消失的操蛋問題，在 onStartup 也要重建選單
chrome.runtime.onStartup.addListener(async () => {
  createContextMenus();
  const data = await storageGet(['isEnabled']);
  updateActionIcon(data.isEnabled ?? true);
});

// 每個分頁的整頁翻譯狀態。Chrome 的 service worker 閒置會被砍，所以存 storage.session；
// 沒有 storage.session 的舊版 Firefox 就放記憶體（它的 background page 是常駐的）
const pageStatusKey = tabId => `pageTranslationStatus_${tabId}`;
const sessionArea = chrome.storage.session || null;
const memoryPageStatus = {};

const getPageStatus = tabId => new Promise(resolve => {
  if (!sessionArea) return resolve(memoryPageStatus[tabId] || false);
  const key = pageStatusKey(tabId);
  sessionArea.get(key, data => resolve((data && data[key]) || false));
});

const setPageStatus = (tabId, isTranslated) => new Promise(resolve => {
  if (!sessionArea) {
    memoryPageStatus[tabId] = isTranslated;
    return resolve();
  }
  sessionArea.set({ [pageStatusKey(tabId)]: isTranslated }, () => resolve());
});

// 右鍵選單是全域共用的，只能反映「目前正在看的分頁」的狀態
const updateContextMenu = async (tabId) => {
  const [activeTab] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (!activeTab || activeTab.id !== tabId) return;
  const isTranslated = await getPageStatus(tabId);
  chrome.contextMenus.update("translate-page", {
    title: isTranslated ? "Restore Page" : "Page Translate"
  });
};

const sendToTab = (tabId, message) => {
  chrome.tabs.sendMessage(tabId, message, () => void chrome.runtime.lastError);
};

const broadcastToTabs = async (message) => {
  const tabs = await queryTabs({});
  tabs.forEach(tab => sendToTab(tab.id, message));
};

// 需要非同步回覆的訊息：回傳 promise 的處理函式
const asyncHandlers = {
  TRANSLATE_BATCH: message => TranslationService.translate(message),

  LIST_LLM_MODELS: async message => {
    try {
      return { models: await TranslationService.listModels(message) };
    } catch (error) {
      return { error: TranslationService.toErrorPayload(error) };
    }
  },

  GET_CACHE_SIZE: async () => ({ size: await TranslationCache.getCacheSize() }),

  CLEAR_TRANSLATION_CACHE: async () => {
    TranslationService.clearMemoryCache();
    await TranslationCache.clearCache();
    return { success: true, size: await TranslationCache.getCacheSize() };
  }
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const asyncHandler = asyncHandlers[message.type];
  if (asyncHandler) {
    asyncHandler(message, sender)
      .then(sendResponse)
      .catch(error => {
        console.error(`Fuck, ${message.type} 失敗:`, error);
        sendResponse({ error: { code: 'unknown', message: String(error?.message || error) } });
      });
    return true;
  }

  // 這幾種訊息從 popup 送來，沒有 sender.tab，不需要 tabId
  switch (message.type) {
    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab ? sender.tab.id : null });
      return;

    case 'TOGGLE_TRANSLATION':
      storageSet({ isEnabled: message.isEnabled });
      updateActionIcon(message.isEnabled);
      broadcastToTabs({ type: "TOGGLE_TRANSLATION", isEnabled: message.isEnabled });
      return;

    case 'SET_TARGET_LANGUAGE':
      storageSet({ targetLanguage: message.language });
      broadcastToTabs({ type: "UPDATE_TARGET_LANGUAGE", targetLanguage: message.language });
      return;
  }

  // 對於其他消息，我們仍然需要 tabId
  const tabId = message.tabId ?? (sender.tab ? sender.tab.id : null);
  if (!tabId) return;

  switch (message.type) {
    case "CONTENT_READY":
      // 頁面重新載入了，原本的翻譯狀態作廢
      setPageStatus(tabId, false).then(() => updateContextMenu(tabId));
      break;

    case "TRANSLATE_PAGE":
      setPageStatus(tabId, true).then(() => updateContextMenu(tabId));
      break;

    case "RESTORE_PAGE":
      setPageStatus(tabId, false).then(() => {
        sendToTab(tabId, { type: "DISABLE_AUTO_TRANSLATION" });
        updateContextMenu(tabId);
      });
      break;
  }
});

// 整頁翻譯 ⇄ 還原（右鍵選單、快捷鍵共用）
const togglePageTranslation = async (tab) => {
  if (!tab || tab.id == null) return;
  const isTranslated = await getPageStatus(tab.id);
  sendToTab(tab.id, { type: isTranslated ? "RESTORE_PAGE" : "TRANSLATE_PAGE" });
  await setPageStatus(tab.id, !isTranslated);
  updateContextMenu(tab.id);
};

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    sendToTab(tab.id, { type: "TRANSLATE_SELECTION", text: info.selectionText });
  } else if (info.menuItemId === "clear-all-translations") {
    broadcastToTabs({ type: "CLEAR_ALL_TRANSLATIONS" });
  } else if (info.menuItemId === "translate-page") {
    togglePageTranslation(tab);
  }
});

// 快捷鍵：用瀏覽器內建的擴充功能快捷鍵，使用者可以在瀏覽器的快捷鍵設定頁自訂或清空停用
const commandHandlers = {
  'toggle-page-translation': togglePageTranslation
};

chrome.commands?.onCommand.addListener(async (command, tab) => {
  const handler = commandHandlers[command];
  if (!handler) return;
  const target = tab || (await queryTabs({ active: true, lastFocusedWindow: true }))[0];
  handler(target);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateContextMenu(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener(async () => {
  const [activeTab] = await queryTabs({ active: true, lastFocusedWindow: true });
  if (activeTab) updateContextMenu(activeTab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessionArea) sessionArea.remove(pageStatusKey(tabId));
  else delete memoryPageStatus[tabId];
});
