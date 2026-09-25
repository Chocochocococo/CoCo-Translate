const DEFAULT_SETTINGS = { targetLanguage: 'zh-TW', isEnabled: true };

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
  chrome.action.setIcon({
    path: { 48: isEnabled ? "icons/icon-48.png" : "icons/icon-disabled-48.png" }
  });
};

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  // 只補上還沒設定過的值，更新擴充功能時別他媽把使用者的設定洗掉
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), data => {
    const missing = {};
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (data[key] === undefined) missing[key] = value;
    }
    if (Object.keys(missing).length) chrome.storage.local.set(missing);
    updateActionIcon(data.isEnabled ?? DEFAULT_SETTINGS.isEnabled);
  });
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  chrome.storage.local.get(['isEnabled'], data => updateActionIcon(data.isEnabled ?? true));
});

// MV3 的 service worker 閒置就會被砍掉，記憶體裡的狀態會跟著消失，
// 所以每個分頁的整頁翻譯狀態存在 storage.session（瀏覽器關掉才清空）
const pageStatusKey = tabId => `pageTranslationStatus_${tabId}`;

const getPageStatus = async (tabId) => {
  const key = pageStatusKey(tabId);
  const data = await chrome.storage.session.get(key);
  return data[key] || false;
};

const setPageStatus = (tabId, isTranslated) =>
  chrome.storage.session.set({ [pageStatusKey(tabId)]: isTranslated });

// 右鍵選單是全域共用的，只能反映「目前正在看的分頁」的狀態
const updateContextMenu = async (tabId) => {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!activeTab || activeTab.id !== tabId) return;
  const isTranslated = await getPageStatus(tabId);
  chrome.contextMenus.update("translate-page", {
    title: isTranslated ? "Restore Page" : "Page Translate"
  });
};

const broadcastToTabs = (message) => {
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, message, () => void chrome.runtime.lastError));
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 這幾種訊息從 popup 送來，沒有 sender.tab，不需要 tabId
  switch (message.type) {
    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab ? sender.tab.id : null });
      return;

    case 'TOGGLE_TRANSLATION':
      chrome.storage.local.set({ isEnabled: message.isEnabled });
      updateActionIcon(message.isEnabled);
      broadcastToTabs({ type: "TOGGLE_TRANSLATION", isEnabled: message.isEnabled });
      return;

    case 'SET_TARGET_LANGUAGE':
      chrome.storage.local.set({ targetLanguage: message.language });
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
        chrome.tabs.sendMessage(tabId, { type: "DISABLE_AUTO_TRANSLATION" }, () => {
          void chrome.runtime.lastError;
          updateContextMenu(tabId);
        });
      });
      break;

    case "ADD_SITE_TRANSLATION":
      chrome.storage.local.get(["siteTranslationList"], data => {
        const siteList = data.siteTranslationList || [];
        if (!siteList.includes(message.url)) {
          siteList.push(message.url);
          chrome.storage.local.set({ siteTranslationList: siteList }, () =>
            sendResponse({ status: "success", message: "Site added successfully" })
          );
        } else {
          sendResponse({ status: "exists", message: "Site already exists" });
        }
      });
      return true;

    case "REMOVE_SITE_TRANSLATION":
      chrome.storage.local.get(["siteTranslationList"], data => {
        const updatedList = (data.siteTranslationList || []).filter(site => site !== message.url);
        chrome.storage.local.set({ siteTranslationList: updatedList }, () =>
          sendResponse({ status: "success", message: "Site removed successfully" })
        );
      });
      return true;
  }
});


chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION", text: info.selectionText });
  } else if (info.menuItemId === "clear-all-translations") {
    broadcastToTabs({ type: "CLEAR_ALL_TRANSLATIONS" });
  } else if (info.menuItemId === "translate-page") {
    const isTranslated = await getPageStatus(tab.id);

    chrome.tabs.sendMessage(tab.id, { type: isTranslated ? "RESTORE_PAGE" : "TRANSLATE_PAGE" });
    await setPageStatus(tab.id, !isTranslated);
    updateContextMenu(tab.id);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateContextMenu(activeInfo.tabId);
});

chrome.windows.onFocusChanged.addListener(async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (activeTab) updateContextMenu(activeTab.id);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(pageStatusKey(tabId));
});

