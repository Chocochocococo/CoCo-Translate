let isEnabled = true,
    targetLanguage = 'zh-TW',
    pageTranslationStatus = {},
    isRestoringPage = {};

// 將右鍵選單創建邏輯封裝到一個函數
function createContextMenus() {
  browser.contextMenus.create({
    id: "translate-selection",
    title: "Selection Translate",
    contexts: ["selection"]
  });
  browser.contextMenus.create({
    id: "clear-all-translations",
    title: "Clear Translations",
    contexts: ["all"]
  });
  browser.contextMenus.create({
    id: "translate-page",
    title: "Page Translate",
    contexts: ["all"]
  });
}

browser.runtime.onInstalled.addListener(() => {
  createContextMenus();
  browser.storage.local.set({ targetLanguage, isEnabled });
});

// 為了解決 Firefox 重啟後右鍵選單消失的操蛋問題，在 onStartup 也要重建選單
browser.runtime.onStartup.addListener(() => {
  browser.contextMenus.removeAll(() => {
    createContextMenus();
  });
});

// 以下其餘的邏輯基本保持不變，fuck it！
const updateContextMenu = (tabId) => {
  const isTranslated = pageTranslationStatus[tabId] || false;
  browser.contextMenus.update("translate-page", {
    title: isTranslated ? "Restore Page" : "Page Translate"
  });
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 針對 TOGGLE_TRANSLATION 的消息，不需要 tabId 檢查
  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab.id });
  }else {
    console.error('Fuck, sender.tab 沒有定義！', sender);
    sendResponse({ tabId: null });
  }
  if (message.type === 'TOGGLE_TRANSLATION') {
    isEnabled = message.isEnabled;
    browser.storage.local.set({ isEnabled });
    browser.browserAction.setIcon({
      path: { 48: isEnabled ? "icons/icon-48.png" : "icons/icon-disabled-48.png" }
    });
    browser.tabs.query({}, tabs => {
      tabs.forEach(tab =>
        browser.tabs.sendMessage(tab.id, {
          type: "TOGGLE_TRANSLATION",
          isEnabled
        })
      );
    });
    return;  // 處理完後直接返回
  }

  // 對於其他消息，我們仍然需要 tabId
  const tabId = sender.tab ? sender.tab.id : message.tabId;
  if (!tabId) return;

  switch (message.type) {
    case 'SET_TARGET_LANGUAGE':
      targetLanguage = message.language;
      browser.storage.local.set({ targetLanguage });
      browser.tabs.query({}, tabs =>
        tabs.forEach(tab =>
          browser.tabs.sendMessage(tab.id, {
            type: "UPDATE_TARGET_LANGUAGE",
            targetLanguage
          })
        )
      );
      break;

    case "TRANSLATE_PAGE":
      pageTranslationStatus[tabId] = true;
      isRestoringPage[tabId] = false;
      updateContextMenu(tabId);
      break;

    case "RESTORE_PAGE":
      pageTranslationStatus[tabId] = false;
      isRestoringPage[tabId] = true;
      browser.tabs.sendMessage(tabId, { type: "DISABLE_AUTO_TRANSLATION" }, () => {
        updateContextMenu(tabId);
      });
      break;

    case "ADD_SITE_TRANSLATION":
      browser.storage.local.get(["siteTranslationList"], data => {
        const siteList = data.siteTranslationList || [];
        if (!siteList.includes(message.url)) {
          siteList.push(message.url);
          browser.storage.local.set({ siteTranslationList: siteList }, () =>
            sendResponse({ status: "success", message: "Site added successfully" })
          );
        } else {
          sendResponse({ status: "exists", message: "Site already exists" });
        }
      });
      return true;

    case "REMOVE_SITE_TRANSLATION":
      browser.storage.local.get(["siteTranslationList"], data => {
        const updatedList = (data.siteTranslationList || []).filter(site => site !== message.url);
        browser.storage.local.set({ siteTranslationList: updatedList }, () =>
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
    browser.tabs.query({}, tabs =>
      tabs.forEach(tab =>
        browser.tabs.sendMessage(tab.id, { type: "CLEAR_ALL_TRANSLATIONS" })
      )
    );
  } else if (info.menuItemId === "translate-page") {
    const isTranslated = pageTranslationStatus[tab.id] || false;
    if (!isTranslated) {
      browser.tabs.sendMessage(tab.id, { type: "TRANSLATE_PAGE" });
      pageTranslationStatus[tab.id] = true;
    } else {
      browser.tabs.sendMessage(tab.id, { type: "RESTORE_PAGE" });
      pageTranslationStatus[tab.id] = false;
    }
    updateContextMenu(tab.id);
  }
});

browser.tabs.onActivated.addListener((activeInfo) => {
  updateContextMenu(activeInfo.tabId);
});

browser.tabs.onRemoved.addListener((tabId) => {
  delete pageTranslationStatus[tabId];
});

