// popup.js

function showCustomWarning(message) {
  // 檢查是否已有現成的提示窗，避免重複產生
  let existingModal = document.getElementById('custom-warning-modal');
  if (existingModal) {
    existingModal.querySelector('p').textContent = message;
    existingModal.style.display = 'flex';
    return;
  }
  
  // 建立覆蓋層
  const modal = document.createElement('div');
  modal.id = 'custom-warning-modal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  // 建立內容容器
  const content = document.createElement('div');
  content.style.backgroundColor = '#fff';
  content.style.padding = '20px';
  content.style.borderRadius = '8px';
  content.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  content.style.textAlign = 'center';
  content.innerHTML = `<p style="margin: 0 0 10px;">${message}</p>`;

  // 建立 OK 按鈕
  const okButton = document.createElement('button');
  okButton.textContent = 'OK';
  okButton.style.padding = '5px 10px';
  okButton.style.border = 'none';
  okButton.style.borderRadius = '4px';
  okButton.style.cursor = 'pointer';
  okButton.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  content.appendChild(okButton);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

// 檢查選擇的翻譯來源是否已儲存對應的 API key
function checkTriggerAPIKey(selectedSource) {
  if (selectedSource === 'google-api') {
    chrome.storage.local.get(['googleApiKey'], data => {
      if (!data.googleApiKey) {
        showCustomWarning('Please enter the Cloud API key!');
      }
    });
  } else if (selectedSource === 'deepl-api') {
    chrome.storage.local.get(['deepLApiKey'], data => {
      if (!data.deepLApiKey) {
        showCustomWarning('Please enter the DeepL API key!');
      }
    });
  } else if (selectedSource === 'mistral-api') { // 新增 Mistral API key 檢查
    chrome.storage.local.get(['mistralApiKey'], data => {
      if (!data.mistralApiKey) {
        showCustomWarning('Please enter the Mistral API key!');
      }
    });
  }
}

// 新增：檢查整頁翻譯 API 的 key
function checkPageAPIKey(selectedSource) {
  if (selectedSource === 'google-api') {
    chrome.storage.local.get(['googleApiKey'], data => {
      if (!data.googleApiKey) {
        showCustomWarning('Please enter the Cloud API key!');
      }
    });
  } else if (selectedSource === 'deepl-api') {
    chrome.storage.local.get(['deepLApiKey'], data => {
      if (!data.deepLApiKey) {
        showCustomWarning('Please enter the DeepL API key!');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  getStorageLang().then((savedLang) => {
    savedLang = savedLang || "zh";
    const languageSelector = document.getElementById("languageSelector");
    languageSelector.value = savedLang;
    applyLanguage(savedLang);

    languageSelector.addEventListener("change", () => {
      const newLang = languageSelector.value;
      applyLanguage(newLang);
      setStorageLang(newLang);
    });
  });
  
  // === 以下為 API 選擇功能的部分 ===
  // 假設 openApiModalBtn 是在 popup.html 中已存在的按鈕
  const openApiModalBtn = document.getElementById('openApiModalBtn');
  
  // 建立模態視窗容器（預先加入 body）
  const apiModal = document.createElement('div');
  apiModal.id = 'apiModal';
  Object.assign(apiModal.style, {
    display: 'none',
    position: 'fixed',
    top: '50%',
    left: '50%',
    width: '250px',
    transform: 'translate(-50%, -50%)',
    background: '#fff',
    padding: '20px',
    border: '1px solid #ccc',
    zIndex: '1000'
  });
  document.body.appendChild(apiModal);
  
  // 定義一個函式用 if 條件根據語言產生模態視窗內容
  function generateModalContent(lang) {
    if (lang === "zh" || lang === "zh-TW") {
      return `
        <h2>翻譯來源</h2>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">觸發式翻譯</label><br>
        <select id="triggerApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
          <option value="mistral-api">Mistral API</option>
        </select>
        <br/><br/>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">整頁翻譯</label><br>
        <select id="pageApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
        </select>
        <br/><br/>
        <button id="saveApiSelection" class="btn" style="width: 100px;">儲存</button>
        <button id="closeApiModal" class="btn secondary" style="width: 100px;">關閉</button>
      `;
    } else {
      return `
        <h2>Translation Source</h2>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">Trigger Translate</label><br>
        <select id="triggerApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
          <option value="mistral-api">Mistral API</option>
        </select>
        <br/><br/>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">Page Translate</label><br>
        <select id="pageApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
        </select>
        <br/><br/>
        <button id="saveApiSelection" class="btn" style="width: 100px;">Save</button>
        <button id="closeApiModal" class="btn secondary" style="width: 100px;">Close</button>
      `;
    }
  }
  
  // 當 openApiModalBtn 被點擊時，根據最新 UI 語言重新生成模態內容
  openApiModalBtn.addEventListener('click', () => {
    // 取得最新的 UI 語言
    const languageSelector = document.getElementById('languageSelector');
    const lang = languageSelector ? languageSelector.value : 'en';
    
    // 產生模態內容，並設定到 apiModal.innerHTML
    apiModal.innerHTML = generateModalContent(lang);
    
    // 顯示模態視窗
    apiModal.style.display = 'block';
    
    // 讀取先前設定
    chrome.storage.local.get(['triggerTranslationSource', 'pageTranslationSource'], data => {
      if (data.triggerTranslationSource) {
        document.getElementById('triggerApiSelect').value = data.triggerTranslationSource;
      }
      if (data.pageTranslationSource) {
        document.getElementById('pageApiSelect').value = data.pageTranslationSource;
      }
    });
    
    // 綁定關閉按鈕
    document.getElementById('closeApiModal').addEventListener('click', () => {
      apiModal.style.display = 'none';
    });
    
    // 綁定儲存按鈕事件
    document.getElementById('saveApiSelection').addEventListener('click', () => {
      const triggerSource = document.getElementById('triggerApiSelect').value;
      const pageSource = document.getElementById('pageApiSelect').value;
      chrome.storage.local.set({
        triggerTranslationSource: triggerSource,
        pageTranslationSource: pageSource
      }, () => {
        chrome.runtime.sendMessage({ type: 'UPDATE_TRIGGER_TRANSLATION_SOURCE', translationSource: triggerSource });
        chrome.runtime.sendMessage({ type: 'UPDATE_PAGE_TRANSLATION_SOURCE', translationSource: pageSource });
        checkTriggerAPIKey(triggerSource);
        checkPageAPIKey(pageSource);
        showCustomWarning('Saved!');
        apiModal.style.display = 'none';
        removeOutsideClickListener();
      });
    });

    setTimeout(() => {
      document.addEventListener('click', outsideClickListener);
    }, 0);
  });
  
  function outsideClickListener(event) {
    // 如果模態視窗正在顯示，且點擊目標不在模態視窗內，則關閉模態視窗
    const apiModal = document.getElementById('apiModal');
    if (apiModal && apiModal.style.display === 'block' && !apiModal.contains(event.target) && event.target !== openApiModalBtn) {
      apiModal.style.display = 'none';
      removeOutsideClickListener();
    }
  }
  
  // 移除外部點擊事件監聽器
  function removeOutsideClickListener() {
    document.removeEventListener('click', outsideClickListener);
  }

  const tabGeneral = document.getElementById('tabGeneral');
  const tabRegex = document.getElementById('tabRegex');
  const tabAPI = document.getElementById('tabAPI');
  const contentGeneral = document.getElementById('contentGeneral');
  const contentRegex = document.getElementById('contentRegex');
  const contentAPI = document.getElementById('contentAPI');

  tabGeneral.addEventListener('click', () => {
    tabGeneral.classList.add('active');
    tabRegex.classList.remove('active');
    tabAPI.classList.remove('active');
    contentGeneral.classList.add('active');
    contentRegex.classList.remove('active');
    contentAPI.classList.remove('active');
  });
  tabRegex.addEventListener('click', () => {
    tabGeneral.classList.remove('active');
    tabRegex.classList.add('active');
    tabAPI.classList.remove('active');
    contentGeneral.classList.remove('active');
    contentRegex.classList.add('active');
    contentAPI.classList.remove('active');
    initRegexPatterns();
  });
  tabAPI.addEventListener('click', () => {
    tabGeneral.classList.remove('active');
    tabRegex.classList.remove('active');
    tabAPI.classList.add('active');
    contentGeneral.classList.remove('active');
    contentRegex.classList.remove('active');
    contentAPI.classList.add('active');
  });

  const saveBtn = document.getElementById('saveBtn'),
        clearBtn = document.getElementById('clearBtn'),
        targetLanguageSelect = document.getElementById('targetLanguage'),
        triggerKeyInput = document.getElementById('triggerKey'),
        toggleTranslationSelect = document.getElementById('toggleTranslation'),
        translatePageBtn = document.getElementById('translatePageBtn'),
        restorePageBtn = document.getElementById('restorePageBtn'),
        openEditorBtn = document.getElementById('openRegexEditor'),
        regexEditorModal = document.getElementById('regexEditorModal'),
        modalPatternList = document.getElementById('modalPatternList'),
        addPatternBtn = document.getElementById('addPatternBtn'),
        closeModalBtn = document.getElementById('closeModal'),
        enableFloatingButtonCheckbox = document.getElementById('enableFloatingButton'),
        inputTargetLanguageSelect = document.getElementById('inputTargetLanguage'),
        enableSelectionButtonCheckbox = document.getElementById('enableSelectionButton'),
        enableCustomRegexCheckbox = document.getElementById('enableCustomRegex'),
        showOriginalTooltipCheckbox = document.getElementById('showOriginalTooltip'),
        useDiskCacheCheckbox = document.getElementById('useDiskCache');
        
  chrome.storage.local.get([
    'useDiskCache', 'targetLanguage', 'triggerKey', 'isEnabled', 
    'inputTargetLanguage', 'enableSelectionButton', 
    'showOriginalTooltip', 'enableCustomRegex'], data => {
    if (data.targetLanguage) targetLanguageSelect.value = data.targetLanguage;
    if (data.triggerKey) triggerKeyInput.value = data.triggerKey;
    if (data.isEnabled !== undefined) toggleTranslationSelect.value = data.isEnabled;
    if (data.inputTargetLanguage) inputTargetLanguageSelect.value = data.inputTargetLanguage;
    enableSelectionButtonCheckbox.checked = data.enableSelectionButton !== false;
    showOriginalTooltipCheckbox.checked = data.showOriginalTooltip !== false;
    enableCustomRegexCheckbox.checked = data.enableCustomRegex !== false;
    useDiskCacheCheckbox.checked = data.useDiskCache || false;
  });

  // 當 checkbox 狀態改變時，立刻存到 chrome.storage.local
  useDiskCacheCheckbox.addEventListener('change', (e) => {
    const useDiskCache = e.target.checked;
    chrome.storage.local.set({ useDiskCache: useDiskCache }, () => {
      if (chrome.runtime.lastError) {
        console.error('儲存設定失敗，真他媽的：', chrome.runtime.lastError);
      } else {
        console.log('本地快取設定已更新為：', useDiskCache);
      }
    });
  });

  enableCustomRegexCheckbox.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ enableCustomRegex: enabled }, () => {
      console.log('自訂正規表達式功能已', enabled ? '啟用' : '關閉');
      chrome.runtime.sendMessage({ type: 'TOGGLE_CUSTOM_REGEX', enabled: enabled });
    });
  });

  enableSelectionButtonCheckbox.addEventListener('change', (e) => {
    const enableSelectionButton = e.target.checked;
    chrome.storage.local.set({ enableSelectionButton: enableSelectionButton });
    chrome.runtime.sendMessage({ type: 'UPDATE_SELECTION_BUTTON', enableSelectionButton: enableSelectionButton });
  });

  showOriginalTooltipCheckbox.addEventListener('change', (e) => {
    const showOriginalTooltip = e.target.checked;
    chrome.storage.local.set({ showOriginalTooltip: showOriginalTooltip });
    chrome.runtime.sendMessage({ type: 'UPDATE_SHOW_ORIGINAL_TOOLTIP', showOriginalTooltip: showOriginalTooltip });
  });
  
  triggerKeyInput.addEventListener('keydown', e => {
    e.preventDefault();
    triggerKeyInput.value = e.code;
  });

  saveBtn.addEventListener('click', () => {
    const selectedLanguage = targetLanguageSelect.value,
          selectedTriggerKey = triggerKeyInput.value.trim(),
          isEnabled = toggleTranslationSelect.value === 'true',
          selectedInputLanguage = inputTargetLanguageSelect.value;
          enableSelectionButton = enableSelectionButtonCheckbox.checked;

      if (selectedTriggerKey) chrome.storage.local.set({ triggerKey: selectedTriggerKey });
      chrome.storage.local.set({ 
        targetLanguage: selectedLanguage, 
        isEnabled, 
        inputTargetLanguage: selectedInputLanguage, 
        enableSelectionButton: enableSelectionButton
      });
      chrome.runtime.sendMessage({ type: 'SET_TARGET_LANGUAGE', language: selectedLanguage });
      chrome.runtime.sendMessage({ type: 'TOGGLE_TRANSLATION', isEnabled });
      chrome.runtime.sendMessage({ type: 'UPDATE_SELECTION_BUTTON', enableSelectionButton: enableSelectionButton });
      showCustomWarning('Settings saved!');
  });

  clearBtn.addEventListener('click', () => {
    chrome.tabs.query({}, tabs =>
      tabs.forEach(tab =>
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ALL_TRANSLATIONS' })
      )
    );
  });

  translatePageBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0].id;
      // 向內容腳本發送消息
      chrome.tabs.sendMessage(tabId, { type: 'TRANSLATE_PAGE' });
      // 同時向背景頁發送消息，附帶 tabId
      chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE', tabId: tabId });
    });
  });

  restorePageBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0].id;
      chrome.tabs.sendMessage(tabId, { type: 'RESTORE_PAGE' });
      chrome.runtime.sendMessage({ type: 'RESTORE_PAGE', tabId: tabId });
    });
  });

  const initRegexPatterns = () => {
    chrome.storage.local.get(['regexPatterns'], data => {
      renderModalPatternList(data.regexPatterns || []);
    });
  };

  const renderModalPatternList = patterns => {
    modalPatternList.innerHTML = patterns.map((pattern, index) => `
      <div class="pattern-item">
        <input type="checkbox" class="pattern-enabled" data-index="${index}" ${pattern.enabled ? 'checked' : ''}>
        <input type="text" class="pattern-input" placeholder="Input Regex" value="${pattern.input}" data-index="${index}">
        <input type="text" class="pattern-output" placeholder="Output Replacement" value="${pattern.output}" data-index="${index}">
        <button class="pattern-delete" data-index="${index}">Delete</button>
      </div>
    `).join('');
    document.querySelectorAll('.pattern-enabled').forEach(el => el.addEventListener('change', togglePatternEnabled));
    document.querySelectorAll('.pattern-input, .pattern-output').forEach(el => el.addEventListener('change', updatePattern));
    document.querySelectorAll('.pattern-delete').forEach(btn => btn.addEventListener('click', deletePattern));
  };

  const togglePatternEnabled = e => {
    const index = e.target.dataset.index;
    chrome.storage.local.get(['regexPatterns'], data => {
      const patterns = data.regexPatterns || [];
      if (patterns[index]) {
        patterns[index].enabled = e.target.checked;
        chrome.storage.local.set({ regexPatterns: patterns }, notifyRegexUpdate);
      }
    });
  };

  const notifyRegexUpdate = () => {
    chrome.tabs.query({}, tabs =>
      tabs.forEach(tab =>
        chrome.tabs.sendMessage(tab.id, { type: 'UPDATE_REGEX_CACHE' })
      )
    );
  };

  document.getElementById('addPatternBtn').addEventListener('click', () => {
    chrome.storage.local.get(['regexPatterns'], data => {
      const patterns = data.regexPatterns || [];
      patterns.push({ input: '', output: '', enabled: true });
      chrome.storage.local.set({ regexPatterns: patterns }, () => {
        renderModalPatternList(patterns);
        notifyRegexUpdate();
      });
    });
  });

  const updatePattern = e => {
    const index = e.target.dataset.index;
    chrome.storage.local.get(['regexPatterns'], data => {
      const patterns = data.regexPatterns || [];
      if (patterns[index]) {
        patterns[index][e.target.classList.contains('pattern-input') ? 'input' : 'output'] = e.target.value;
        chrome.storage.local.set({ regexPatterns: patterns }, notifyRegexUpdate);
      }
    });
  };

  const deletePattern = e => {
    const index = e.target.dataset.index;
    chrome.storage.local.get(['regexPatterns'], data => {
      const patterns = data.regexPatterns || [];
      patterns.splice(index, 1);
      chrome.storage.local.set({ regexPatterns: patterns }, () => {
        renderModalPatternList(patterns);
        notifyRegexUpdate();
      });
    });
  };

  const checkbox = document.getElementById('alwaysTranslateCheckbox');
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const currentUrl = new URL(tabs[0].url).origin;
    chrome.storage.local.get(["siteTranslationList"], data => {
      checkbox.checked = (data.siteTranslationList || []).includes(currentUrl);
    });
    checkbox.addEventListener('change', () => {
      chrome.storage.local.get(["siteTranslationList"], data => {
        let siteList = data.siteTranslationList || [];
        if (checkbox.checked) {
          if (!siteList.includes(currentUrl)) siteList.push(currentUrl);
        } else {
          siteList = siteList.filter(site => site !== currentUrl);
        }
        chrome.storage.local.set({ siteTranslationList: siteList });
      });
    });
  });

  document.getElementById('exportRegex').addEventListener('click', () => {
    console.log('Export 按鈕被點擊');
    chrome.storage.local.get(['regexPatterns'], data => {
      console.log('取得 regexPatterns：', data.regexPatterns);
      const blob = new Blob([JSON.stringify(data.regexPatterns || [], null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'regex_patterns.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
  
  document.getElementById('importRegex').addEventListener('click', () => {
    console.log('Import 按鈕被點擊');
    // 檢查是否真的觸發檔案輸入元素的 click 事件
    document.getElementById('importRegexFile').click();
  });
  
  document.getElementById('importRegexFile').addEventListener('change', e => {
    console.log('檔案輸入 change 事件觸發');
    const file = e.target.files[0];
    if (file) {
      console.log('選擇的檔案：', file.name);
      const reader = new FileReader();
      reader.onload = evt => {
        console.log('檔案讀取完成');
        try {
          const imported = JSON.parse(evt.target.result);
          console.log('匯入的 JSON：', imported);
          if (Array.isArray(imported)) {
            chrome.storage.local.set({ regexPatterns: imported }, () => {
              showCustomWarning('Imported successfully!');
              initRegexPatterns();
            });
          } else {
            showCustomWarning('Invalid file format.');
          }
        } catch (error) {
          showCustomWarning('Error reading the file.');
          console.error('Error:', error);
        }
      };
      reader.readAsText(file);
    }
  });
  

  chrome.storage.local.get(['enableFloatingButton'], data => {
    enableFloatingButtonCheckbox.checked = data.enableFloatingButton !== false;
  });

  enableFloatingButtonCheckbox.addEventListener('change', () => {
    const isEnabled = enableFloatingButtonCheckbox.checked;
    chrome.storage.local.set({ enableFloatingButton: isEnabled }, () => {
      console.log('Floating button setting saved:', isEnabled);
      chrome.runtime.sendMessage({ type: 'TOGGLE_FLOATING_BUTTON', isEnabled });
    });
  });

  if(contentRegex.classList.contains('active')){
    initRegexPatterns();
  }
  
  // API
  const googleApiKeyInput = document.getElementById('googleApiKey');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
  const deleteApiKeyBtn = document.getElementById('deleteApiKeyBtn');

  const deepLApiKeyInput = document.getElementById('deepLApiKey');
  const saveDeepLApiKeyBtn = document.getElementById('saveDeepLApiKeyBtn');
  const deleteDeepLApiKeyBtn = document.getElementById('deleteDeepLApiKeyBtn');
  const deepLAccountTypeSelect = document.getElementById('deepLAccountType');

  const mistralApiKeyInput = document.getElementById('mistralApiKey');
  const saveMistralApiKeyBtn = document.getElementById('saveMistralApiKeyBtn');
  const deleteMistralApiKeyBtn = document.getElementById('deleteMistralApiKeyBtn');

  // 讀取 Google API Key
  chrome.storage.local.get(['googleApiKey'], data => {
    if (data.googleApiKey) {
      googleApiKeyInput.value = '********';
    }
  });

  saveApiKeyBtn.addEventListener('click', () => {
    const enteredKey = googleApiKeyInput.value.trim();
    if (enteredKey === '' || enteredKey === '********') {
      showCustomWarning('Please enter Cloud API key.');
      return;
    }
    chrome.storage.local.set({ googleApiKey: enteredKey }, () => {
      showCustomWarning('Cloud API key saved!');
      googleApiKeyInput.value = '********';
    });
  });

  deleteApiKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove('googleApiKey', () => {
      showCustomWarning('Cloud API key deleted!');
      googleApiKeyInput.value = '';
    });
  });

  googleApiKeyInput.addEventListener('focus', () => {
    if (googleApiKeyInput.value === '********') {
      googleApiKeyInput.value = '';
    }
  });

  // 讀取 DeepL API Key
  chrome.storage.local.get(['deepLApiKey'], data => {
    if (data.deepLApiKey) {
      deepLApiKeyInput.value = '********';
    }
  });

  saveDeepLApiKeyBtn.addEventListener('click', () => {
    const enteredKey = deepLApiKeyInput.value.trim();
    if (enteredKey === '' || enteredKey === '********') {
      showCustomWarning('Please enter DeepL API key.');
      return;
    }
    chrome.storage.local.set({ deepLApiKey: enteredKey }, () => {
      showCustomWarning('DeepL API key saved!');
      deepLApiKeyInput.value = '********';
    });
  });

  deleteDeepLApiKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove('deepLApiKey', () => {
      showCustomWarning('DeepL API key deleted!');
      deepLApiKeyInput.value = '';
    });
  });

  deepLApiKeyInput.addEventListener('focus', () => {
    if (deepLApiKeyInput.value === '********') {
      deepLApiKeyInput.value = '';
    }
  });

  // 讀取 DeepL Account Type
  chrome.storage.local.get(['deepLAccountType'], data => {
    if (data.deepLAccountType) {
      deepLAccountTypeSelect.value = data.deepLAccountType;
    } else {
      deepLAccountTypeSelect.value = 'free';
    }
  });

  deepLAccountTypeSelect.addEventListener('change', () => {
    const selectedType = deepLAccountTypeSelect.value;
    chrome.storage.local.set({ deepLAccountType: selectedType }, () => {
      console.log('DeepL Account Type 已更新為：' + selectedType);
    });
  });

  //Mistral API
  chrome.storage.local.get(['mistralApiKey'], data => {
    if (data.mistralApiKey) {
      mistralApiKeyInput.value = '********';
    }
  });

  saveMistralApiKeyBtn.addEventListener('click', () => {
    const enteredKey = mistralApiKeyInput.value.trim();
    if (enteredKey === '' || enteredKey === '********') {
      showCustomWarning('Please enter Mistral API key.');
      return;
    }
    chrome.storage.local.set({ mistralApiKey: enteredKey }, () => {
      showCustomWarning('Mistral API key saved!');
      mistralApiKeyInput.value = '********';
    });
  });

  deleteMistralApiKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove('mistralApiKey', () => {
      showCustomWarning('Mistral API key deleted!');
      mistralApiKeyInput.value = '';
    });
  });

  mistralApiKeyInput.addEventListener('focus', () => {
    if (mistralApiKeyInput.value === '********') {
      mistralApiKeyInput.value = '';
    }
  });

  //快取
  const cacheSizeDisplay = document.getElementById('cacheSizeDisplay');
  if (cacheSizeDisplay) {
    try {
      const size = await TranslationCache.getCacheSize();
      cacheSizeDisplay.textContent = `Cache Size: ${size}`;
      console.log('Popup: Current cache size is', size);
    } catch (error) {
      console.error('Popup: Error getting cache size:', error);
      cacheSizeDisplay.textContent = `Cache Size: 0B`;
    }
  }
  
  // 如果你希望在清除快取後也即時更新快取空間，記得在清除快取的 click 事件中重新呼叫更新
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      chrome.tabs.create({ url: 'https://hypnotic-denim-05e.notion.site/1a1cbce1913780f7b850c0592ae7a0b9?pvs=4' });
     /* console.log('Popup: Clear Cache button clicked, fuck yeah!');
      try {
        // 先清除 popup 的 DB
        await TranslationCache.clearCache();
        // 通知 content script 刪除它的 DB
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            chrome.tabs.sendMessage(tabs[0].id, { type: 'CLEAR_TRANSLATION_CACHE' });
          }
        });
        showCustomWarning('Translation cache successfully cleared!');
      } catch (e) {
        console.error('Popup: Error clearing translation cache:', e);
        showCustomWarning('Failed to clear cache. Please try again!');
      } finally {
       */
        // 重新更新快取空間顯示
        try {
          const size = await TranslationCache.getCacheSize();
          cacheSizeDisplay.textContent = `Cache Size: ${size}`;
          console.log('Popup: Cache size updated to', size);
        } catch (error) {
          console.error('Popup: Error updating cache size:', error);
          cacheSizeDisplay.textContent = `Cache Size: 0B`;
        }
      //}
    });
  }
  
  /*document.getElementById('editTranslationsBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0].id;
      window.open('editTranslations.html?tabId=' + tabId, '_blank', 'width=600,height=400');
    });
  });    
  */

// 自訂右鍵選單
const contextMenuSelect = document.getElementById('radio');
contextMenuSelect.addEventListener('change', function() {
  const selectedMode = this.value;
  chrome.storage.local.set({ customContextMenuMode: selectedMode }, function() {
    console.log('右鍵選單模式已設定為：' + selectedMode);
  });
});

// 載入時自動設置下拉選單的值（預設為模式2）
chrome.storage.local.get(['customContextMenuMode'], function(result) {
  const mode = result.customContextMenuMode || "2";
  contextMenuSelect.value = mode;
});

//prompt自訂

// 載入時設定下拉選單選擇值
chrome.storage.local.get({ customPromptIndex: -1 }, data => {
  const promptSelect = document.getElementById('promptSelect');
  // 若 customPromptIndex 為 -1，則設為空字串，否則轉成字串
  promptSelect.value = data.customPromptIndex === -1 ? '' : data.customPromptIndex.toString();
});

// 更新下拉選單的函數，根據儲存的 customPrompts 陣列更新選項
function updatePromptSelect(prompts) {
  const promptSelect = document.getElementById('promptSelect');
  promptSelect.innerHTML = ''; // 清空現有選項
  
  // 增加一個預設選項：使用預設 prompt
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Default Prompt';
  promptSelect.appendChild(defaultOption);
  
  // 增加用戶儲存的各組 prompt 選項
  prompts.forEach((item, index) => {
    const option = document.createElement('option');
    option.value = index; // 用索引作為 value
    option.textContent = item.name;
    promptSelect.appendChild(option);
  });
  
  // 讀取儲存的 customPromptIndex 並設置給下拉選單
  chrome.storage.local.get({ customPromptIndex: -1 }, data => {
    promptSelect.value = data.customPromptIndex === -1 ? '' : data.customPromptIndex.toString();
  });
}

// 讀取並更新自訂 prompt 下拉選單
chrome.storage.local.get({ customPrompts: [] }, data => {
  updatePromptSelect(data.customPrompts);
});

// 監聽儲存自訂 prompt的按鈕
document.getElementById('saveCustomPromptBtn').addEventListener('click', () => {
  const promptNameInput = document.getElementById('promptName');
  const customPromptInput = document.getElementById('customPrompt');
  const promptName = promptNameInput.value.trim();
  const customPrompt = customPromptInput.value.trim();
  if (!customPrompt) {
    showCustomWarning("請輸入自訂 prompt 內容！");
    return;
  }
  // 如果 promptName 沒有填，預設為 "Custom"
  const finalName = promptName || "Custom";
  chrome.storage.local.get({ customPrompts: [] }, data => {
    let prompts = data.customPrompts;
    // 新增這組自訂 prompt
    prompts.push({ name: finalName, content: customPrompt });
    chrome.storage.local.set({ customPrompts: prompts }, () => {
      showCustomWarning("自訂 prompt 儲存成功！");
      // 更新下拉選單
      updatePromptSelect(prompts);
    });
  });
});

// 監聽下拉選單變更，儲存所選 prompt 的索引
document.getElementById('promptSelect').addEventListener('change', e => {
  const selectedIndex = e.target.value; // 預設選項值為空字串
  const index = selectedIndex === "" ? -1 : parseInt(selectedIndex, 10);
  chrome.storage.local.set({ customPromptIndex: index });
});

// 刪除自訂 prompt 的邏輯
document.getElementById('deleteCustomPromptBtn').addEventListener('click', () => {
  const promptSelect = document.getElementById('promptSelect');
  const selectedIndex = promptSelect.value; // 如果預設選項 value 為空，代表沒選自訂 prompt
  if (selectedIndex === "" || selectedIndex === "-1") {
    showCustomWarning("No custom prompt selected for deletion.");
    return;
  }
  chrome.storage.local.get({ customPrompts: [] }, data => {
    let prompts = data.customPrompts;
    const index = parseInt(selectedIndex, 10);
    if (index >= 0 && index < prompts.length) {
      prompts.splice(index, 1);
      chrome.storage.local.set({ customPrompts: prompts }, () => {
        showCustomWarning("Custom prompt deleted successfully.");
        updatePromptSelect(prompts);
      });
    } else {
      showCustomWarning("Invalid prompt selection.");
    }
  });
});

});