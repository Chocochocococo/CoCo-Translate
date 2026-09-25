const DEFAULT_SETTINGS = { targetLanguage: 'zh-TW', isEnabled: true };

// 每個分頁的整頁翻譯狀態（Firefox 的 background page 是常駐的，放記憶體就好）
const pageTranslationStatus = {};

const MENU_ITEMS = [
  { id: "translate-selection", title: "Selection Translate", contexts: ["selection"] },
  { id: "clear-all-translations", title: "Clear Translations", contexts: ["all"] },
  { id: "translate-page", title: "Page Translate", contexts: ["all"] }
];

// 將右鍵選單創建邏輯封裝到一個函數，先清空再建立，避免重複 id
function createContextMenus() {
  return browser.contextMenus.removeAll().then(() => {
    MENU_ITEMS.forEach(item => browser.contextMenus.create(item));
  });
}

const updateActionIcon = (isEnabled) => {
  browser.browserAction.setIcon({
    path: { 48: isEnabled ? "icons/icon-48.png" : "icons/icon-disabled-48.png" }
  });
};

browser.runtime.onInstalled.addListener(async () => {
  createContextMenus();
  // 只補上還沒設定過的值，更新擴充功能時別他媽把使用者的設定洗掉
  const data = await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (data[key] === undefined) missing[key] = value;
  }
  if (Object.keys(missing).length) browser.storage.local.set(missing);
  updateActionIcon(data.isEnabled ?? DEFAULT_SETTINGS.isEnabled);
});

// 為了解決 Firefox 重啟後右鍵選單消失的操蛋問題，在 onStartup 也要重建選單
browser.runtime.onStartup.addListener(async () => {
  createContextMenus();
  const data = await browser.storage.local.get(['isEnabled']);
  updateActionIcon(data.isEnabled ?? true);
});

// 右鍵選單是全域共用的，只能反映「目前正在看的分頁」的狀態
const updateContextMenu = async (tabId) => {
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab || activeTab.id !== tabId) return;
  const isTranslated = pageTranslationStatus[tabId] || false;
  browser.contextMenus.update("translate-page", {
    title: isTranslated ? "Restore Page" : "Page Translate"
  });
};

const broadcastToTabs = async (message) => {
  const tabs = await browser.tabs.query({});
  tabs.forEach(tab => browser.tabs.sendMessage(tab.id, message).catch(() => {}));
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 這幾種訊息從 popup 送來，沒有 sender.tab，不需要 tabId
  switch (message.type) {
    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab ? sender.tab.id : null });
      return;

    case 'TOGGLE_TRANSLATION':
      browser.storage.local.set({ isEnabled: message.isEnabled });
      updateActionIcon(message.isEnabled);
      broadcastToTabs({ type: "TOGGLE_TRANSLATION", isEnabled: message.isEnabled });
      return;

    case 'SET_TARGET_LANGUAGE':
      browser.storage.local.set({ targetLanguage: message.language });
      broadcastToTabs({ type: "UPDATE_TARGET_LANGUAGE", targetLanguage: message.language });
      return;
  }

  // 對於其他消息，我們仍然需要 tabId
  const tabId = message.tabId ?? (sender.tab ? sender.tab.id : null);
  if (!tabId) return;

  switch (message.type) {
    case "CONTENT_READY":
      // 頁面重新載入了，原本的翻譯狀態作廢
      pageTranslationStatus[tabId] = false;
      updateContextMenu(tabId);
      break;

    case "TRANSLATE_PAGE":
      pageTranslationStatus[tabId] = true;
      updateContextMenu(tabId);
      break;

    case "RESTORE_PAGE":
      pageTranslationStatus[tabId] = false;
      browser.tabs.sendMessage(tabId, { type: "DISABLE_AUTO_TRANSLATION" })
        .catch(() => {})
        .then(() => updateContextMenu(tabId));
      break;

    case "ADD_SITE_TRANSLATION":
      browser.storage.local.get(["siteTranslationList"]).then(data => {
        const siteList = data.siteTranslationList || [];
        if (!siteList.includes(message.url)) {
          siteList.push(message.url);
          browser.storage.local.set({ siteTranslationList: siteList }).then(() =>
            sendResponse({ status: "success", message: "Site added successfully" })
          );
        } else {
          sendResponse({ status: "exists", message: "Site already exists" });
        }
      });
      return true;

    case "REMOVE_SITE_TRANSLATION":
      browser.storage.local.get(["siteTranslationList"]).then(data => {
        const updatedList = (data.siteTranslationList || []).filter(site => site !== message.url);
        browser.storage.local.set({ siteTranslationList: updatedList }).then(() =>
          sendResponse({ status: "success", message: "Site removed successfully" })
        );
      });
      return true;
  }
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    browser.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION", text: info.selectionText });
  } else if (info.menuItemId === "clear-all-translations") {
    broadcastToTabs({ type: "CLEAR_ALL_TRANSLATIONS" });
  } else if (info.menuItemId === "translate-page") {
    const isTranslated = pageTranslationStatus[tab.id] || false;
    browser.tabs.sendMessage(tab.id, { type: isTranslated ? "RESTORE_PAGE" : "TRANSLATE_PAGE" });
    pageTranslationStatus[tab.id] = !isTranslated;
    updateContextMenu(tab.id);
  }
});

browser.tabs.onActivated.addListener((activeInfo) => {
  updateContextMenu(activeInfo.tabId);
});

browser.windows.onFocusChanged.addListener(async () => {
  const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) updateContextMenu(activeTab.id);
});

browser.tabs.onRemoved.addListener((tabId) => {
  delete pageTranslationStatus[tabId];
});
