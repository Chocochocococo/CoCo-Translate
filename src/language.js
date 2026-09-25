// 這是你的多語系字典
const i18nStrings = {
    en: {
      tabGeneral: "Settings",
      tabRegex: "Edit Regex Patterns",
      UIlanguage: "UI Language:",
      ATTS: "Always translate this site",
      SOTPG: "Show Original Text Tooltip in Page Translate",
      EITB: "Enable Input Translate Button",
      ESTB: "Enable Selection Translation Button",
      ECR: "Enable Custom Regex",
      Transsource: "Translation Source:",
      Contextmenu: "Context Menu:",
      cocomenu: "CoCo Menu",
      bothmenu: "Both Menu",
      defaultmenu: "Default Menu",
      targetlanguage: "Target Language:",
      inputlanguage: "Input Target Language:",
      triggerkeyui: "Trigger Key:",
      enabletrigger: "Enable Trigger:",
      saveBtn: "Save Settings",
      clearBtn: "Clear Triggered",
      translatePageBtn: "Translate Page",
      restorePageBtn: "Restore Page",
      addPatternBtn: "Add New Pattern",
      exportRegex: "Export",
      importRegex: "Import",
      tabAPIID: "API Settings",
      googleApiKeyID: "Cloud API Key:",
      saveApiKeyBtnID: "Save",
      deleteApiKeyBtnID: "Delete",
      deepLApiKeyID: "DeepL API Key:",
      saveDeepLApiKeyBtnID: "Save",
      deleteDeepLApiKeyBtnID: "Delete",
      deepLAccountTypelabelID: "DeepL Account Type:",
      useDiskCacheLabelID: "Enable local cached translation",
      clearCacheBtnID: "Clear Cache",
      shortcutLabelID: "Shortcut:",
      openShortcutSettingsBtnID: "Set Shortcuts",
      Importrexgexpatterns: "Import Regex Patterns",
      Importrexgexpatternsdes: "Select your custom Regular Expression JSON file and load it into the extension. Importing will overwrite the existing patterns.",
      importBtnid: "Import Regex File",
      promptNametitleID: "Prompt Name:",
      saveCustomPromptBtnID: "Save Prompt",
      customPrompttitleID: "Custom Prompt:",
      promptSelecttitleID: "Select Prompt:",
      deleteCustomPromptBtnID: "Delete Prompt",
      openApiModalBtnID: "Click to open settings",
      llmSectionTitleID: "AI Translation (LLM)",
      llmProviderLabelID: "Provider:",
      llmBaseUrlLabelID: "API Base URL:",
      llmApiKeyLabelID: "API Key:",
      llmModelLabelID: "Model:",
      fetchLlmModelsBtnID: "Load Models",
      saveLlmBtnID: "Save",
      deleteLlmKeyBtnID: "Delete API Key"
    },
    zh: {
      tabGeneral: "一般設定",
      tabRegex: "編輯正規表達式",
      UIlanguage: "介面語言",
      ATTS: "總是翻譯此網站",
      SOTPG: "整頁翻譯時顯示原文提示",
      EITB: "啟用輸入翻譯懸浮按鈕",
      ESTB: "啟用觸發翻譯懸浮按鈕",
      ECR: "啟用自訂正規表達式",
      Transsource: "翻譯來源：",
      Contextmenu: "右鍵選單：",
      cocomenu: "僅顯示可可選單",
      bothmenu: "同時顯示兩種選單",
      defaultmenu: "僅顯示預設選單",
      targetlanguage: "目標語言：",
      inputlanguage: "輸入翻譯目標語言：",
      triggerkeyui: "觸發翻譯鍵：",
      enabletrigger: "啟用觸發翻譯：",
      saveBtn: "儲存設定",
      clearBtn: "清除譯文",
      translatePageBtn: "翻譯網頁",
      restorePageBtn: "還原網頁原文",
      addPatternBtn: "新增正規表達式",
      exportRegex: "匯出",
      importRegex: "匯入",
      tabAPIID: "API設定",
      googleApiKeyID: "Cloud API金鑰：",
      saveApiKeyBtnID: "儲存",
      deleteApiKeyBtnID: "刪除",
      deepLApiKeyID: "DeepL API金鑰：",
      saveDeepLApiKeyBtnID: "儲存",
      deleteDeepLApiKeyBtnID: "刪除",
      deepLAccountTypelabelID: "DeepL帳戶類型：",
      useDiskCacheLabelID: "啟用本地快取譯文",
      clearCacheBtnID: "清除快取",
      shortcutLabelID: "快捷鍵：",
      openShortcutSettingsBtnID: "設定快捷鍵",
      Importrexgexpatterns: "匯入正規表達式",
      Importrexgexpatternsdes: "選擇你的自訂正規表達式 JSON 檔案，並加載到擴充功能中。匯入後會覆蓋現有的正規表達式。",
      importBtnid: "匯入檔案",
      promptNametitleID: "Prompt名稱：",
      saveCustomPromptBtnID: "儲存Prompt",
      customPrompttitleID: "自訂Prompt:",
      promptSelecttitleID: "選擇Prompt:",
      deleteCustomPromptBtnID: "刪除Prompt",
      openApiModalBtnID: "點擊開啟設定",
      llmSectionTitleID: "AI 翻譯（LLM）",
      llmProviderLabelID: "供應商：",
      llmBaseUrlLabelID: "API 網址：",
      llmApiKeyLabelID: "API 金鑰：",
      llmModelLabelID: "模型：",
      fetchLlmModelsBtnID: "載入模型清單",
      saveLlmBtnID: "儲存",
      deleteLlmKeyBtnID: "刪除金鑰"
    }
  };
  
  /**
   * 幫你把字典裡的字串套用到對應的 HTML 元素
   * 只要保證 HTML 有對應的 id，就能改文字。
   */
  function applyLanguage(lang) {
    const dict = i18nStrings[lang] || i18nStrings.en;
    
    setText("openApiModalBtn", dict.openApiModalBtnID);
    setText("useDiskCacheLabel", dict.useDiskCacheLabelID);
    setText("clearCacheBtn", dict.clearCacheBtnID);
    setText("shortcutLabel", dict.shortcutLabelID);
    setText("openShortcutSettingsBtn", dict.openShortcutSettingsBtnID);

    // Options 頁（匯入正規表達式）
    setText("Importrexgexpatternsid", dict.Importrexgexpatterns);
    setText("Importrexgexpatternsdesid", dict.Importrexgexpatternsdes);
    setText("importBtn", dict.importBtnid);

    // Tab & General
    setText("tabGeneral", dict.tabGeneral);
    setText("tabRegex", dict.tabRegex);
    setText("tabAPI", dict.tabAPIID);
  
    // 「UI Language:」(假設HTML裡對應的 label id="uiLanguageLabel")
    setText("uiLanguageLabel", dict.UIlanguage);
  
    // Checkboxes / Labels
    // 例如：<span id="alwaysTranslateLabel">Always translate this site</span>
    setText("alwaysTranslateLabel", dict.ATTS);
    setText("showOriginalTooltipLabel", dict.SOTPG);
    setText("enableFloatingButtonLabel", dict.EITB);
    setText("enableSelectionButtonLabel", dict.ESTB);
    setText("enableCustomRegexLabel", dict.ECR);
  
    // 翻譯來源、右鍵選單
    setText("translationSourceLabel", dict.Transsource);
    setText("contextMenuLabel", dict.Contextmenu);
  
    // 這裡是下拉式選單的三個 option
    // 假設 HTML: <option value="1">CoCo Menu</option>, <option value="2">Both Menu</option>, <option value="3">Default Menu</option>
    const optCoco = document.querySelector('#radio option[value="1"]');
    const optBoth = document.querySelector('#radio option[value="2"]');
    const optDefault = document.querySelector('#radio option[value="3"]');
    if (optCoco) optCoco.textContent = dict.cocomenu;
    if (optBoth) optBoth.textContent = dict.bothmenu;
    if (optDefault) optDefault.textContent = dict.defaultmenu;
  
    // 目標語言 & 輸入語言 Label
    setText("targetLanguageLabel", dict.targetlanguage);
    setText("inputTargetLanguageLabel", dict.inputlanguage);
  
    // 觸發鍵
    setText("triggerKeyLabel", dict.triggerkeyui);
    setText("toggleTranslationLabel", dict.enabletrigger);
  
    // 按鈕
    setText("saveBtn", dict.saveBtn);
    setText("clearBtn", dict.clearBtn);
    setText("translatePageBtn", dict.translatePageBtn);
    setText("restorePageBtn", dict.restorePageBtn);
    setText("addPatternBtn", dict.addPatternBtn);
    setText("exportRegex", dict.exportRegex);
    setText("importRegex", dict.importRegex);

    //API
    setText("googleApiKeyNAME", dict.googleApiKeyID);
    setText("saveApiKeyBtn", dict.saveApiKeyBtnID);
    setText("deleteApiKeyBtn", dict.deleteApiKeyBtnID);
    setText("deepLApiKeyNAME", dict.deepLApiKeyID);
    setText("saveDeepLApiKeyBtn", dict.saveDeepLApiKeyBtnID);
    setText("deleteDeepLApiKeyBtn", dict.deleteDeepLApiKeyBtnID);
    setText("deepLAccountTypelabel", dict.deepLAccountTypelabelID);
    setText("llmSectionTitle", dict.llmSectionTitleID);
    setText("llmProviderLabel", dict.llmProviderLabelID);
    setText("llmBaseUrlLabel", dict.llmBaseUrlLabelID);
    setText("llmApiKeyLabel", dict.llmApiKeyLabelID);
    setText("llmModelLabel", dict.llmModelLabelID);
    setText("fetchLlmModelsBtn", dict.fetchLlmModelsBtnID);
    setText("saveLlmBtn", dict.saveLlmBtnID);
    setText("deleteLlmKeyBtn", dict.deleteLlmKeyBtnID);

    //Prompt
    setText("promptNametitle", dict.promptNametitleID);
    setText("saveCustomPromptBtn", dict.saveCustomPromptBtnID);
    setText("customPrompttitle", dict.customPrompttitleID);
    setText("promptSelecttitle", dict.promptSelecttitleID);
    setText("deleteCustomPromptBtn", dict.deleteCustomPromptBtnID
    );
  }
  
  /**
   * 小工具函式：設定元素的 textContent
   * 如果找不到該 id，就不做
   */
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
    }
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
  