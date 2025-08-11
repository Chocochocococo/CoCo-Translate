let isEnabled = true,
    targetLanguage = 'zh-TW',
    pageTranslationStatus = {},
    isRestoringPage = {};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "translate-selection",
    title: "Selection Translate",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "clear-all-translations",
    title: "Clear Translations",
    contexts: ["all"]
  });
  chrome.contextMenus.create({
    id: "translate-page",
    title: "Page Translate",
    contexts: ["all"]
  });
  chrome.storage.local.set({ targetLanguage, isEnabled });
});

const updateContextMenu = (tabId) => {
  const isTranslated = pageTranslationStatus[tabId] || false;
  chrome.contextMenus.update("translate-page", {
    title: isTranslated ? "Restore Page" : "Page Translate"
  });
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 針對 TOGGLE_TRANSLATION 的消息，不需要 tabId 檢查
  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab.id });
  }else {
    console.error('Fuck, sender.tab 沒有定義！', sender);
    sendResponse({ tabId: null });
  }
  if (message.type === 'TOGGLE_TRANSLATION') {
    isEnabled = message.isEnabled;
    chrome.storage.local.set({ isEnabled });
    chrome.action.setIcon({
      path: { 48: isEnabled ? "icons/icon-48.png" : "icons/icon-disabled-48.png" }
    });
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab =>
        chrome.tabs.sendMessage(tab.id, {
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
      chrome.storage.local.set({ targetLanguage });
      chrome.tabs.query({}, tabs =>
        tabs.forEach(tab =>
          chrome.tabs.sendMessage(tab.id, {
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
      chrome.tabs.sendMessage(tabId, { type: "DISABLE_AUTO_TRANSLATION" }, () => {
        updateContextMenu(tabId);
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


chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-selection" && info.selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION", text: info.selectionText });
  } else if (info.menuItemId === "clear-all-translations") {
    chrome.tabs.query({}, tabs =>
      tabs.forEach(tab =>
        chrome.tabs.sendMessage(tab.id, { type: "CLEAR_ALL_TRANSLATIONS" })
      )
    );
  } else if (info.menuItemId === "translate-page") {
    const isTranslated = pageTranslationStatus[tab.id] || false;

    if (!isTranslated) {
      chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_PAGE" });
      pageTranslationStatus[tab.id] = true;
    } else {
      chrome.tabs.sendMessage(tab.id, { type: "RESTORE_PAGE" });
      pageTranslationStatus[tab.id] = false;
    }
    updateContextMenu(tab.id);
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  updateContextMenu(activeInfo.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  delete pageTranslationStatus[tabId];
});


