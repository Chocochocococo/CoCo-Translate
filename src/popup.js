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
  const messageParagraph = document.createElement('p');
  messageParagraph.style.margin = '0 0 10px';
  messageParagraph.style.whiteSpace = 'pre-line';
  messageParagraph.textContent = message;
  content.appendChild(messageParagraph);

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

// 讀取 AI 翻譯設定（舊版只有 mistralApiKey，順便轉成新格式）
function loadLLMSettings(callback) {
  chrome.storage.local.get(['llmSettings', 'mistralApiKey'], data => {
    let settings = data.llmSettings;
    if (!settings) {
      settings = data.mistralApiKey
        ? { provider: 'mistral', providers: { mistral: { apiKey: data.mistralApiKey, model: 'mistral-large-latest' } } }
        : { provider: 'ollama-cloud', providers: {} };
    }
    settings.providers = settings.providers || {};
    callback(settings);
  });
}

const LLM_PROVIDERS_NEED_KEY = ['ollama-cloud', 'openrouter', 'gemini', 'groq', 'mistral'];

// 檢查選擇的翻譯來源是否已儲存對應的 API key，回傳警告訊息（沒問題就回傳空字串）
function checkAPIKey(selectedSource, isPage) {
  return new Promise(resolve => {
    const zh = (document.getElementById('languageSelector')?.value || 'zh') === 'zh';
    if (selectedSource === 'google-api') {
      chrome.storage.local.get(['googleApiKey'], data => {
        resolve(data.googleApiKey ? '' : 'Please enter the Cloud API key!');
      });
    } else if (selectedSource === 'deepl-api') {
      chrome.storage.local.get(['deepLApiKey'], data => {
        resolve(data.deepLApiKey ? '' : 'Please enter the DeepL API key!');
      });
    } else if (selectedSource === 'llm') {
      loadLLMSettings(settings => {
        const config = settings.providers[settings.provider] || {};
        const warnings = [];
        if (LLM_PROVIDERS_NEED_KEY.includes(settings.provider) && !config.apiKey) {
          warnings.push(zh ? '請先到 API 設定填入 AI 翻譯的 API Key！' : 'Please enter the AI translation API key in API Settings!');
        }
        if (isPage && settings.provider !== 'ollama-local' && settings.provider !== 'custom') {
          warnings.push(zh
            ? '用 AI 做整頁翻譯會很快用光免費額度，建議整頁翻譯用 Google / Bing，或改用本機 Ollama。'
            : 'Page translation with AI burns through free quotas quickly. Consider Google / Bing or a local Ollama for page translation.');
        }
        resolve(warnings.join('\n'));
      });
    } else {
      resolve('');
    }
  });
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
          <option value="llm">AI (LLM)</option>
        </select>
        <br/><br/>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">整頁翻譯</label><br>
        <select id="pageApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
          <option value="llm">AI (LLM)</option>
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
          <option value="llm">AI (LLM)</option>
        </select>
        <br/><br/>
        <label style="font-weight: bold; font-size: 14px; cursor: pointer;">Page Translate</label><br>
        <select id="pageApiSelect" style="padding: 6px; font-size: 13px; border: 1px solid #ddd; border-radius: 4px; width: 180px; box-sizing: border-box;">
          <option value="google">Google Translate</option>
          <option value="google-api">Cloud Translation</option>
          <option value="bing">Bing</option>
          <option value="deepl-api">DeepL API</option>
          <option value="llm">AI (LLM)</option>
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
        // 舊版的 mistral-api 現在歸到 AI (LLM)
        document.getElementById('triggerApiSelect').value =
          data.triggerTranslationSource === 'mistral-api' ? 'llm' : data.triggerTranslationSource;
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
      }, async () => {
        const warnings = [...new Set([
          await checkAPIKey(triggerSource, false),
          await checkAPIKey(pageSource, true)
        ].filter(Boolean))];
        showCustomWarning(['Saved!', ...warnings].join('\n'));
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

  // YouTube 雙語字幕（預設關閉，改了馬上生效）
  const youTubeSubtitlesCheckbox = document.getElementById('enableYouTubeSubtitles');
  chrome.storage.local.get(['enableYouTubeSubtitles'], data => {
    youTubeSubtitlesCheckbox.checked = data.enableYouTubeSubtitles === true;
  });
  youTubeSubtitlesCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ enableYouTubeSubtitles: youTubeSubtitlesCheckbox.checked });
  });
  // 字幕框顯示原文＋譯文，或只顯示譯文
  const youTubeModeSelect = document.getElementById('youTubeSubtitleMode');
  chrome.storage.local.get(['youTubeSubtitleMode'], data => {
    youTubeModeSelect.value = data.youTubeSubtitleMode === 'translation' ? 'translation' : 'bilingual';
  });
  youTubeModeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ youTubeSubtitleMode: youTubeModeSelect.value });
  });

  enableSelectionButtonCheckbox.addEventListener('change', (e) => {
    const enableSelectionButton = e.target.checked;
    chrome.storage.local.set({ enableSelectionButton: enableSelectionButton });
  });

  showOriginalTooltipCheckbox.addEventListener('change', (e) => {
    const showOriginalTooltip = e.target.checked;
    chrome.storage.local.set({ showOriginalTooltip: showOriginalTooltip });
  });
  
  triggerKeyInput.addEventListener('keydown', e => {
    e.preventDefault();
    triggerKeyInput.value = e.code;
  });

  saveBtn.addEventListener('click', () => {
    const selectedLanguage = targetLanguageSelect.value,
          selectedTriggerKey = triggerKeyInput.value.trim(),
          isEnabled = toggleTranslationSelect.value === 'true',
          selectedInputLanguage = inputTargetLanguageSelect.value,
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
    modalPatternList.innerHTML = '';
    patterns.forEach((pattern, index) => {
      const item = document.createElement('div');
      item.className = 'pattern-item';

      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.className = 'pattern-enabled';
      enabled.dataset.index = index;
      enabled.checked = !!pattern.enabled;
      enabled.addEventListener('change', togglePatternEnabled);

      const makeText = (className, placeholder, value) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = className;
        input.placeholder = placeholder;
        input.value = value ?? '';
        input.dataset.index = index;
        input.addEventListener('change', updatePattern);
        return input;
      };

      const deleteButton = document.createElement('button');
      deleteButton.className = 'pattern-delete';
      deleteButton.dataset.index = index;
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', deletePattern);

      item.append(
        enabled,
        makeText('pattern-input', 'Input Regex', pattern.input),
        makeText('pattern-output', 'Output Replacement', pattern.output),
        deleteButton
      );
      modalPatternList.appendChild(item);
    });
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
    const tab = tabs[0];
    let currentUrl = null;
    try {
      currentUrl = new URL(tab.url).origin;
    } catch (e) {
      // 拿不到網址就算了
    }
    const zh = () => (document.getElementById('languageSelector')?.value || 'zh') === 'zh';
    // chrome:// 、about: 這類頁面跑不了 content script，勾了也沒用
    if (!currentUrl || !/^https?:/.test(currentUrl)) {
      checkbox.disabled = true;
      return;
    }
    // 萬用字元規則（*.example.com）也算：設定頁加的規則，這裡一樣會打勾
    chrome.storage.local.get(["siteTranslationList"], data => {
      checkbox.checked = !!SitePatterns.findMatch(data.siteTranslationList, tab.url);
    });
    checkbox.addEventListener('change', () => {
      const shouldTranslate = checkbox.checked;
      chrome.storage.local.get(["siteTranslationList"], data => {
        let siteList = data.siteTranslationList || [];
        if (shouldTranslate) {
          if (!siteList.includes(currentUrl)) siteList.push(currentUrl);
        } else {
          const exact = SitePatterns.exactEntriesFor(siteList, tab.url);
          siteList = siteList.filter(site => !exact.includes(site));
          // 還有萬用字元規則套用在這個網站 → 這裡拿不掉，請使用者到設定頁管理
          const stillMatched = SitePatterns.findMatch(siteList, tab.url);
          if (stillMatched) {
            checkbox.checked = true;
            showCustomWarning(zh()
              ? `這個網站是由規則「${stillMatched}」套用的，請到設定頁的網站清單修改。`
              : `This site is covered by the rule "${stillMatched}". Edit it in the site list on the settings page.`);
            if (!exact.length) return;
          }
        }
        chrome.storage.local.set({ siteTranslationList: siteList }, () => {
          if (!shouldTranslate && SitePatterns.findMatch(siteList, tab.url)) return;
          // 勾選當下就直接翻譯、取消勾選就還原，不用再重新整理頁面
          const type = shouldTranslate ? 'TRANSLATE_PAGE' : 'RESTORE_PAGE';
          chrome.tabs.sendMessage(tab.id, { type }, () => void chrome.runtime.lastError);
          chrome.runtime.sendMessage({ type, tabId: tab.id }, () => void chrome.runtime.lastError);
        });
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
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#regex') });
  });

  chrome.storage.local.get(['enableFloatingButton'], data => {
    enableFloatingButtonCheckbox.checked = data.enableFloatingButton !== false;
  });

  enableFloatingButtonCheckbox.addEventListener('change', () => {
    const isEnabled = enableFloatingButtonCheckbox.checked;
    chrome.storage.local.set({ enableFloatingButton: isEnabled }, () => {
      console.log('Floating button setting saved:', isEnabled);
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

  // AI 翻譯（OpenAI 相容）
  const LLM_PRESET_INFO = {
    'ollama-cloud': {
      baseUrl: 'https://ollama.com/v1',
      model: 'gemma4:31b',
      hint: {
        zh: '到 ollama.com 登入後，在 Settings → Keys 建立金鑰。免費方案同時只能 1 個請求，額度有限。',
        en: 'Create a key at ollama.com (Settings → Keys). The free plan allows 1 request at a time with limited usage.'
      }
    },
    'openrouter': {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-4-31b-it:free',
      hint: {
        zh: '到 openrouter.ai/keys 建立金鑰。模型名稱結尾是 :free 的就免費（每分鐘 20 次、每天 50 次）。',
        en: 'Create a key at openrouter.ai/keys. Models ending in :free cost nothing (20 requests/min, 50/day).'
      }
    },
    'gemini': {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-3.5-flash-lite',
      hint: {
        zh: '到 aistudio.google.com 建立 API Key。Flash-Lite 系列免費，每天約 500 次、每分鐘約 10 次。',
        en: 'Create a key at aistudio.google.com. Flash-Lite models are free: about 500 requests/day, ~10/min.'
      }
    },
    'groq': {
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'qwen/qwen3.8-27b',
      hint: {
        zh: '到 console.groq.com 建立 API Key。免費方案每天 1,000 次、每分鐘 30 次，但每分鐘只有 8,000 token，不適合整頁翻譯。',
        en: 'Create a key at console.groq.com. Free: 1,000 requests/day, 30/min, but only 8,000 tokens/min — not for page translation.'
      }
    },
    'mistral': {
      baseUrl: 'https://api.mistral.ai/v1',
      model: 'mistral-large-latest',
      hint: {
        zh: 'Mistral 已取消免費 API 額度，需要另外購買點數。',
        en: 'Mistral no longer includes a free API allowance; credits are sold separately.'
      }
    },
    'ollama-local': {
      baseUrl: 'http://localhost:11434/v1',
      model: '',
      hint: {
        zh: '需要在電腦上安裝並執行 Ollama（ollama.com/download），不需要金鑰，也沒有額度限制。',
        en: 'Requires Ollama running on this computer (ollama.com/download). No key, no quota.'
      }
    },
    'custom': {
      baseUrl: '',
      model: '',
      hint: {
        zh: '任何 OpenAI 相容的 API（LM Studio、Groq…），Base URL 通常以 /v1 結尾。',
        en: 'Any OpenAI-compatible API (LM Studio, Groq…). The base URL usually ends with /v1.'
      }
    }
  };

  const llmProviderSelect = document.getElementById('llmProvider');
  const llmBaseUrlInput = document.getElementById('llmBaseUrl');
  const llmApiKeyInput = document.getElementById('llmApiKey');
  const llmModelInput = document.getElementById('llmModel');
  const llmModelList = document.getElementById('llmModelList');
  const llmHint = document.getElementById('llmHint');
  let llmSettings = { provider: 'ollama-cloud', providers: {} };

  const uiLang = () => (document.getElementById('languageSelector')?.value || 'zh') === 'zh' ? 'zh' : 'en';

  const renderLLMProvider = () => {
    const provider = llmProviderSelect.value;
    const info = LLM_PRESET_INFO[provider];
    const config = llmSettings.providers[provider] || {};
    llmHint.textContent = info.hint[uiLang()];
    llmBaseUrlInput.placeholder = info.baseUrl || 'https://example.com/v1';
    llmBaseUrlInput.value = config.baseUrl || '';
    llmApiKeyInput.value = config.apiKey ? '********' : '';
    llmModelInput.placeholder = info.model || 'model name';
    llmModelInput.value = config.model || info.model;
    llmModelList.innerHTML = '';
  };

  loadLLMSettings(settings => {
    llmSettings = settings;
    llmProviderSelect.value = settings.provider in LLM_PRESET_INFO ? settings.provider : 'ollama-cloud';
    renderLLMProvider();
  });

  llmProviderSelect.addEventListener('change', renderLLMProvider);
  document.getElementById('languageSelector').addEventListener('change', () => {
    llmHint.textContent = LLM_PRESET_INFO[llmProviderSelect.value].hint[uiLang()];
  });

  llmApiKeyInput.addEventListener('focus', () => {
    if (llmApiKeyInput.value === '********') {
      llmApiKeyInput.value = '';
    }
  });

  // 欄位是 ******** 或空白就沿用已存的金鑰
  const currentLLMApiKey = () => {
    const entered = llmApiKeyInput.value.trim();
    const saved = (llmSettings.providers[llmProviderSelect.value] || {}).apiKey || '';
    return entered && entered !== '********' ? entered : saved;
  };

  document.getElementById('saveLlmBtn').addEventListener('click', () => {
    const provider = llmProviderSelect.value;
    const apiKey = currentLLMApiKey();
    const model = llmModelInput.value.trim();
    const baseUrl = llmBaseUrlInput.value.trim();
    if (provider === 'custom' && !baseUrl) {
      showCustomWarning(uiLang() === 'zh' ? '請輸入 API Base URL！' : 'Please enter the API base URL!');
      return;
    }
    if (!model && !LLM_PRESET_INFO[provider].model) {
      showCustomWarning(uiLang() === 'zh' ? '請輸入或載入模型名稱！' : 'Please enter or load a model name!');
      return;
    }
    llmSettings.provider = provider;
    llmSettings.providers[provider] = { apiKey, model, baseUrl };
    chrome.storage.local.set({ llmSettings }, () => {
      showCustomWarning(uiLang() === 'zh' ? 'AI 翻譯設定已儲存！' : 'AI translation settings saved!');
      renderLLMProvider();
    });
  });

  document.getElementById('deleteLlmKeyBtn').addEventListener('click', () => {
    const provider = llmProviderSelect.value;
    if (llmSettings.providers[provider]) llmSettings.providers[provider].apiKey = '';
    chrome.storage.local.set({ llmSettings }, () => {
      showCustomWarning('API key deleted!');
      llmApiKeyInput.value = '';
    });
  });

  document.getElementById('fetchLlmModelsBtn').addEventListener('click', () => {
    const button = document.getElementById('fetchLlmModelsBtn');
    button.disabled = true;
    chrome.runtime.sendMessage({
      type: 'LIST_LLM_MODELS',
      provider: llmProviderSelect.value,
      apiKey: currentLLMApiKey(),
      baseUrl: llmBaseUrlInput.value.trim()
    }, response => {
      button.disabled = false;
      if (chrome.runtime.lastError || !response) {
        showCustomWarning('Failed to load models: ' + (chrome.runtime.lastError?.message || 'no response'));
        return;
      }
      if (response.error) {
        showCustomWarning('Failed to load models: ' + response.error.message);
        return;
      }
      llmModelList.innerHTML = '';
      response.models.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        llmModelList.appendChild(option);
      });
      llmHint.textContent = uiLang() === 'zh'
        ? `找到 ${response.models.length} 個模型，點模型欄位就能選。`
        : `Found ${response.models.length} models. Click the model field to pick one.`;
      llmModelInput.value = '';
      llmModelInput.focus();
    });
  });

  document.getElementById('manageSitesBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#sites') });
  });
  document.getElementById('openGlossaryBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#glossary') });
  });
  document.getElementById('openVocabularyBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#vocabulary') });
  });

  // 快捷鍵（瀏覽器內建的擴充功能快捷鍵：可以自訂，也可以清空停用）
  const shortcutDisplay = document.getElementById('shortcutDisplay');
  const refreshShortcut = () => {
    if (!chrome.commands?.getAll) return;
    chrome.commands.getAll(commands => {
      const command = (commands || []).find(c => c.name === 'toggle-page-translation');
      shortcutDisplay.textContent = command?.shortcut || (uiLang() === 'zh' ? '未設定' : 'Not set');
    });
  };
  refreshShortcut();
  document.getElementById('languageSelector').addEventListener('change', refreshShortcut);

  document.getElementById('openShortcutSettingsBtn').addEventListener('click', () => {
    // Firefox 137 以後有現成的 API 可以直接打開快捷鍵設定
    if (chrome.commands?.openShortcutSettings) {
      chrome.commands.openShortcutSettings();
      return;
    }
    if (navigator.userAgent.includes('Firefox')) {
      showCustomWarning(uiLang() === 'zh'
        ? '請到「附加元件管理員」→ 右上角齒輪 →「管理擴充套件快捷鍵」設定。'
        : 'Open Add-ons Manager → gear menu → "Manage Extension Shortcuts".');
      return;
    }
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  //快取（快取在 background，整個擴充功能共用一份）
  const cacheSizeDisplay = document.getElementById('cacheSizeDisplay');
  const refreshCacheSize = () => {
    chrome.runtime.sendMessage({ type: 'GET_CACHE_SIZE' }, response => {
      if (chrome.runtime.lastError || !response || response.error) {
        cacheSizeDisplay.textContent = `Cache Size: 0 B`;
        return;
      }
      cacheSizeDisplay.textContent = `Cache Size: ${response.size}`;
    });
  };
  refreshCacheSize();

  document.getElementById('clearCacheBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_TRANSLATION_CACHE' }, response => {
      if (chrome.runtime.lastError || !response || response.error) {
        showCustomWarning('Failed to clear cache. Please try again!');
        return;
      }
      showCustomWarning('Translation cache successfully cleared!');
      refreshCacheSize();
    });
  });

  /*document.getElementById('editTranslationsBtn').addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0].id;
      window.open('editTranslations.html?tabId=' + tabId, '_blank', 'width=600,height=400');
    });
  });    
  */

// 整頁翻譯顯示方式（改了馬上生效，翻譯中的分頁會自動重新排）
const pageDisplayModeSelect = document.getElementById('pageDisplayMode');
chrome.storage.local.get(['pageDisplayMode'], data => {
  pageDisplayModeSelect.value = data.pageDisplayMode === 'bilingual' ? 'bilingual' : 'replace';
});
pageDisplayModeSelect.addEventListener('change', () => {
  chrome.storage.local.set({ pageDisplayMode: pageDisplayModeSelect.value });
});

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