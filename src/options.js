// options.js — 設定頁：一般設定、翻譯來源與 AI、網站清單、術語表、生字本、正規表達式
// 全部改了就存（金鑰、AI 設定、Prompt 這種要先填完的才有儲存按鈕）

const $ = id => document.getElementById(id);
const t = (zh, en) => (currentUiLang === 'zh' ? zh : en);

// 語言切換後要重畫的東西（清單的刪除按鈕、提示文字……）
const languageListeners = [];
const onLanguageChange = listener => languageListeners.push(listener);

// 小工具：建立一列「內容 + 刪除按鈕」
function createListItem(contentNodes, onDelete, className = '') {
  const item = document.createElement('li');
  if (className) item.className = className;
  const grow = document.createElement('div');
  grow.className = 'grow';
  grow.append(...contentNodes);
  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn danger small';
  deleteButton.type = 'button';
  deleteButton.textContent = i18n('delete');
  deleteButton.addEventListener('click', onDelete);
  item.append(grow, deleteButton);
  return item;
}

// 小工具：把內容存成檔案下載
function downloadFile(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 小工具：選 JSON 檔 → 解析 → 交給 callback
function bindJsonImport(buttonId, inputId, onData) {
  const input = $(inputId);
  $(buttonId).addEventListener('click', () => input.click());
  input.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      let data;
      try {
        data = JSON.parse(evt.target.result);
      } catch (error) {
        data = undefined;
      }
      onData(data);
      input.value = '';
    };
    reader.readAsText(file);
  });
}

// ---------------- 分頁切換 ----------------
function showSection(id) {
  const sections = [...document.querySelectorAll('.panel')];
  // section 的 id 故意加 panel- 前綴：跟網址的 #sites 一樣的話，瀏覽器會自己捲過去把標題切掉，幹
  const target = sections.find(section => section.id === `panel-${id}`) || sections[0];
  sections.forEach(section => section.classList.toggle('active', section === target));
  document.querySelectorAll('.side-nav a').forEach(link => {
    const active = `panel-${link.dataset.section}` === target.id;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

// ---------------- 一般 ----------------
function initGeneral() {
  const languageSelector = $('languageSelector');
  languageSelector.addEventListener('change', () => setStorageLang(languageSelector.value));
  bindThemeSegmented('themeSegmented');

  bindSelect('targetLanguage', 'targetLanguage', {
    defaultValue: 'zh-TW',
    onChange: language => chrome.runtime.sendMessage({ type: 'SET_TARGET_LANGUAGE', language })
  });
  bindSegmented('pageDisplayMode', 'pageDisplayMode', {
    defaultValue: 'replace',
    normalize: value => (value === 'bilingual' ? 'bilingual' : 'replace')
  });
  bindSwitch('showOriginalTooltip', 'showOriginalTooltip', { defaultValue: true });

  // 觸發翻譯：背景會存 isEnabled、換圖示、通知所有分頁
  bindSwitch('toggleTranslation', 'isEnabled', {
    defaultValue: true,
    onChange: isEnabled => chrome.runtime.sendMessage({ type: 'TOGGLE_TRANSLATION', isEnabled })
  });

  // 觸發鍵：點欄位後按一個鍵就存，顯示成人看得懂的名字
  const triggerKeyInput = $('triggerKey');
  let triggerKey = 'ControlRight';
  const showTriggerKey = () => {
    triggerKeyInput.value = formatKeyCode(triggerKey);
  };
  chrome.storage.local.get(['triggerKey'], data => {
    triggerKey = data.triggerKey || 'ControlRight';
    showTriggerKey();
  });
  triggerKeyInput.addEventListener('focus', () => {
    triggerKeyInput.classList.add('listening');
    triggerKeyInput.value = t('請按一個鍵…', 'Press a key…');
  });
  triggerKeyInput.addEventListener('blur', () => {
    triggerKeyInput.classList.remove('listening');
    showTriggerKey();
  });
  triggerKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    if (e.key === 'Escape') {
      triggerKeyInput.blur();
      return;
    }
    triggerKey = e.code;
    chrome.storage.local.set({ triggerKey });
    triggerKeyInput.blur();
  });

  bindSwitch('enableSelectionButton', 'enableSelectionButton', { defaultValue: true });
  bindSwitch('enableFloatingButton', 'enableFloatingButton', { defaultValue: true });
  bindSelect('inputTargetLanguage', 'inputTargetLanguage', { defaultValue: 'en' });
  bindSelect('contextMenuMode', 'customContextMenuMode', { defaultValue: '2' });

  bindSwitch('enableYouTubeSubtitles', 'enableYouTubeSubtitles');
  bindSegmented('youTubeSubtitleMode', 'youTubeSubtitleMode', {
    defaultValue: 'bilingual',
    normalize: value => (value === 'translation' ? 'translation' : 'bilingual')
  });
  bindSelect('youTubeSubtitleScale', 'youTubeSubtitleScale', { defaultValue: '1', normalize: value => String(value) });
  // 在影片上拖過字幕框之後，這裡可以一鍵放回原本 CC 的位置（在影片上按兩下字幕框也可以）
  const resetPositionButton = $('resetYouTubePositionBtn');
  const showPositionState = position => { resetPositionButton.disabled = !position; };
  chrome.storage.local.get(['youTubeSubtitlePosition'], data => showPositionState(data.youTubeSubtitlePosition));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.youTubeSubtitlePosition) showPositionState(changes.youTubeSubtitlePosition.newValue);
  });
  resetPositionButton.addEventListener('click', () => chrome.storage.local.remove('youTubeSubtitlePosition'));

  // 背景的 PostProcess 直接監聽 storage，改了馬上生效
  bindSwitch('enableCustomRegex', 'enableCustomRegex', { defaultValue: true });
  bindSwitch('useDiskCache', 'useDiskCache');

  // 快捷鍵（瀏覽器內建的擴充功能快捷鍵：可以自訂，也可以清空停用）
  const refreshShortcut = () => {
    if (!chrome.commands?.getAll) return;
    chrome.commands.getAll(commands => {
      const command = (commands || []).find(c => c.name === 'toggle-page-translation');
      $('shortcutDisplay').textContent = command?.shortcut || i18n('notSet');
    });
  };
  refreshShortcut();
  onLanguageChange(refreshShortcut);
  // 從瀏覽器的快捷鍵設定頁切回來時更新
  window.addEventListener('focus', refreshShortcut);

  $('openShortcutSettingsBtn').addEventListener('click', () => {
    // Firefox 137 以後有現成的 API 可以直接打開快捷鍵設定
    if (chrome.commands?.openShortcutSettings) {
      chrome.commands.openShortcutSettings();
      return;
    }
    if (navigator.userAgent.includes('Firefox')) {
      showCustomWarning(t('請到「附加元件管理員」→ 右上角齒輪 →「管理擴充套件快捷鍵」設定。',
        'Open Add-ons Manager → gear menu → "Manage Extension Shortcuts".'));
      return;
    }
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  // 快取（快取在 background，整個擴充功能共用一份）
  let cacheSize = '…';
  const showCacheSize = () => {
    $('cacheSizeDisplay').textContent = i18n('cacheSize', { size: cacheSize });
  };
  const refreshCacheSize = () => {
    chrome.runtime.sendMessage({ type: 'GET_CACHE_SIZE' }, response => {
      cacheSize = chrome.runtime.lastError || !response || response.error ? '0 B' : response.size;
      showCacheSize();
    });
  };
  refreshCacheSize();
  onLanguageChange(showCacheSize);

  $('clearCacheBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_TRANSLATION_CACHE' }, response => {
      if (chrome.runtime.lastError || !response || response.error) {
        showCustomWarning(t('清除快取失敗，請再試一次！', 'Failed to clear cache. Please try again!'));
        return;
      }
      showCustomWarning(t('翻譯快取已清除！', 'Translation cache cleared!'));
      refreshCacheSize();
    });
  });
}

// ---------------- 翻譯來源與 AI ----------------
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

function initSources() {
  const refreshWarning = async () => {
    const message = await sourceWarnings($('triggerSource').value, $('pageSource').value);
    $('sourceWarning').textContent = message;
    $('sourceWarning').classList.toggle('hidden', !message);
  };
  bindSelect('triggerSource', 'triggerTranslationSource', { defaultValue: 'google', normalize: normalizeSource, onChange: refreshWarning });
  bindSelect('pageSource', 'pageTranslationSource', { defaultValue: 'google', normalize: normalizeSource, onChange: refreshWarning });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const keys = ['triggerTranslationSource', 'pageTranslationSource', 'googleApiKey', 'deepLApiKey', 'llmSettings'];
    if (keys.some(key => key in changes)) refreshWarning();
  });
  chrome.storage.local.get(['triggerTranslationSource', 'pageTranslationSource'], refreshWarning);
  onLanguageChange(refreshWarning);

  // Google Cloud、DeepL 金鑰：存好的只顯示 ********
  const bindKey = (inputId, saveId, deleteId, key, name) => {
    const input = $(inputId);
    chrome.storage.local.get([key], data => {
      if (data[key]) input.value = '********';
    });
    input.addEventListener('focus', () => {
      if (input.value === '********') input.value = '';
    });
    $(saveId).addEventListener('click', () => {
      const entered = input.value.trim();
      if (!entered || entered === '********') {
        showCustomWarning(t(`請輸入 ${name} API 金鑰。`, `Please enter the ${name} API key.`));
        return;
      }
      chrome.storage.local.set({ [key]: entered }, () => {
        input.value = '********';
        showCustomWarning(t(`${name} API 金鑰已儲存！`, `${name} API key saved!`));
      });
    });
    $(deleteId).addEventListener('click', () => {
      chrome.storage.local.remove(key, () => {
        input.value = '';
        showCustomWarning(t(`${name} API 金鑰已刪除。`, `${name} API key deleted.`));
      });
    });
  };
  bindKey('googleApiKey', 'saveApiKeyBtn', 'deleteApiKeyBtn', 'googleApiKey', 'Cloud');
  bindKey('deepLApiKey', 'saveDeepLApiKeyBtn', 'deleteDeepLApiKeyBtn', 'deepLApiKey', 'DeepL');
  bindSelect('deepLAccountType', 'deepLAccountType', { defaultValue: 'free' });

  initLLM();
  initPrompts();
}

function initLLM() {
  const providerSelect = $('llmProvider');
  const baseUrlInput = $('llmBaseUrl');
  const apiKeyInput = $('llmApiKey');
  const modelInput = $('llmModel');
  const modelList = $('llmModelList');
  const hint = $('llmHint');
  let llmSettings = { provider: 'ollama-cloud', providers: {} };

  const showHint = () => {
    hint.textContent = LLM_PRESET_INFO[providerSelect.value].hint[currentUiLang === 'zh' ? 'zh' : 'en'];
  };

  const renderProvider = () => {
    const provider = providerSelect.value;
    const info = LLM_PRESET_INFO[provider];
    const config = llmSettings.providers[provider] || {};
    showHint();
    baseUrlInput.placeholder = info.baseUrl || 'https://example.com/v1';
    baseUrlInput.value = config.baseUrl || '';
    apiKeyInput.value = config.apiKey ? '********' : '';
    modelInput.placeholder = info.model || 'model name';
    modelInput.value = config.model || info.model;
    modelList.innerHTML = '';
  };

  loadLLMSettings(settings => {
    llmSettings = settings;
    providerSelect.value = settings.provider in LLM_PRESET_INFO ? settings.provider : 'ollama-cloud';
    renderProvider();
  });

  providerSelect.addEventListener('change', renderProvider);
  onLanguageChange(showHint);

  apiKeyInput.addEventListener('focus', () => {
    if (apiKeyInput.value === '********') apiKeyInput.value = '';
  });

  // 欄位是 ******** 或空白就沿用已存的金鑰
  const currentApiKey = () => {
    const entered = apiKeyInput.value.trim();
    const saved = (llmSettings.providers[providerSelect.value] || {}).apiKey || '';
    return entered && entered !== '********' ? entered : saved;
  };

  $('saveLlmBtn').addEventListener('click', () => {
    const provider = providerSelect.value;
    const apiKey = currentApiKey();
    const model = modelInput.value.trim();
    const baseUrl = baseUrlInput.value.trim();
    if (provider === 'custom' && !baseUrl) {
      showCustomWarning(t('請輸入 API 網址！', 'Please enter the API base URL!'));
      return;
    }
    if (!model && !LLM_PRESET_INFO[provider].model) {
      showCustomWarning(t('請輸入或載入模型名稱！', 'Please enter or load a model name!'));
      return;
    }
    llmSettings.provider = provider;
    llmSettings.providers[provider] = { apiKey, model, baseUrl };
    chrome.storage.local.set({ llmSettings }, () => {
      showCustomWarning(t('AI 翻譯設定已儲存！', 'AI translation settings saved!'));
      renderProvider();
    });
  });

  $('deleteLlmKeyBtn').addEventListener('click', () => {
    const provider = providerSelect.value;
    if (llmSettings.providers[provider]) llmSettings.providers[provider].apiKey = '';
    chrome.storage.local.set({ llmSettings }, () => {
      apiKeyInput.value = '';
      showCustomWarning(t('API 金鑰已刪除。', 'API key deleted.'));
    });
  });

  $('fetchLlmModelsBtn').addEventListener('click', () => {
    const button = $('fetchLlmModelsBtn');
    button.disabled = true;
    chrome.runtime.sendMessage({
      type: 'LIST_LLM_MODELS',
      provider: providerSelect.value,
      apiKey: currentApiKey(),
      baseUrl: baseUrlInput.value.trim()
    }, response => {
      button.disabled = false;
      const error = chrome.runtime.lastError?.message || (!response ? 'no response' : response.error?.message);
      if (error) {
        showCustomWarning(t('載入模型清單失敗：', 'Failed to load models: ') + error);
        return;
      }
      modelList.innerHTML = '';
      response.models.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        modelList.appendChild(option);
      });
      hint.textContent = t(`找到 ${response.models.length} 個模型，點模型欄位就能選。`,
        `Found ${response.models.length} models. Click the model field to pick one.`);
      modelInput.value = '';
      modelInput.focus();
    });
  });
}

function initPrompts() {
  const promptSelect = $('promptSelect');
  let prompts = [];
  let selectedIndex = -1;

  const render = () => {
    promptSelect.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = i18n('promptDefault');
    promptSelect.appendChild(defaultOption);
    prompts.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = item.name;
      promptSelect.appendChild(option);
    });
    promptSelect.value = selectedIndex >= 0 && selectedIndex < prompts.length ? String(selectedIndex) : '';
    $('deleteCustomPromptBtn').disabled = promptSelect.value === '';
  };

  chrome.storage.local.get({ customPrompts: [], customPromptIndex: -1 }, data => {
    prompts = data.customPrompts;
    selectedIndex = data.customPromptIndex;
    render();
  });
  onLanguageChange(render);

  promptSelect.addEventListener('change', () => {
    selectedIndex = promptSelect.value === '' ? -1 : parseInt(promptSelect.value, 10);
    chrome.storage.local.set({ customPromptIndex: selectedIndex });
    $('deleteCustomPromptBtn').disabled = selectedIndex < 0;
  });

  $('saveCustomPromptBtn').addEventListener('click', () => {
    const content = $('customPrompt').value.trim();
    if (!content) {
      showCustomWarning(t('請輸入自訂 Prompt 內容！', 'Please enter the prompt text!'));
      return;
    }
    // 名稱沒填就叫 Custom
    prompts.push({ name: $('promptName').value.trim() || 'Custom', content });
    selectedIndex = prompts.length - 1;
    chrome.storage.local.set({ customPrompts: prompts, customPromptIndex: selectedIndex }, () => {
      $('promptName').value = '';
      $('customPrompt').value = '';
      render();
      showCustomWarning(t('自訂 Prompt 已儲存，並設為使用中。', 'Prompt saved and selected.'));
    });
  });

  $('deleteCustomPromptBtn').addEventListener('click', () => {
    const index = promptSelect.value === '' ? -1 : parseInt(promptSelect.value, 10);
    if (index < 0 || index >= prompts.length) return;
    if (!confirm(t(`確定要刪除「${prompts[index].name}」嗎？`, `Delete "${prompts[index].name}"?`))) return;
    prompts.splice(index, 1);
    selectedIndex = -1;
    chrome.storage.local.set({ customPrompts: prompts, customPromptIndex: -1 }, render);
  });
}

// ---------------- 總是翻譯的網站 ----------------
function initSites() {
  const input = $('siteInput');
  const list = $('siteList');
  let current = [];

  const render = (sites = current) => {
    current = sites;
    list.innerHTML = '';
    sites.forEach(site => {
      const code = document.createElement('code');
      code.textContent = site;
      list.appendChild(createListItem([code], () => {
        chrome.storage.local.get(['siteTranslationList'], data => {
          const updated = (data.siteTranslationList || []).filter(entry => entry !== site);
          chrome.storage.local.set({ siteTranslationList: updated });
        });
      }));
    });
    $('siteListEmpty').classList.toggle('hidden', sites.length > 0);
  };

  const add = () => {
    const pattern = SitePatterns.normalize(input.value);
    if (!pattern) {
      showCustomWarning(t('看不懂這個網址，請輸入像 example.com 或 *.example.com 這樣的格式。',
        'Please enter something like example.com or *.example.com.'));
      return;
    }
    chrome.storage.local.get(['siteTranslationList'], data => {
      const sites = data.siteTranslationList || [];
      if (!sites.includes(pattern)) sites.push(pattern);
      chrome.storage.local.set({ siteTranslationList: sites }, () => {
        input.value = '';
      });
    });
  };

  $('addSiteBtn').addEventListener('click', add);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') add();
  });

  chrome.storage.local.get(['siteTranslationList'], data => render(data.siteTranslationList || []));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.siteTranslationList) render(changes.siteTranslationList.newValue || []);
  });
  onLanguageChange(() => render());
}

// ---------------- 術語表 ----------------
function initGlossary() {
  const source = $('glossarySource');
  const target = $('glossaryTarget');
  const site = $('glossarySite');
  const list = $('glossaryList');
  let current = [];

  const save = entries => chrome.storage.local.set({ glossary: entries });
  const load = callback => chrome.storage.local.get(['glossary'], data => callback(data.glossary || []));

  const render = (entries = current) => {
    current = entries;
    list.innerHTML = '';
    entries.forEach((entry, index) => {
      const text = document.createElement('span');
      text.textContent = `${entry.source} → ${entry.target}`;
      const scope = document.createElement('code');
      scope.style.marginLeft = '8px';
      scope.textContent = entry.site || t('所有網站', 'all sites');
      list.appendChild(createListItem([text, scope], () => {
        load(latest => save(latest.filter((_, i) => i !== index)));
      }));
    });
    $('glossaryEmpty').classList.toggle('hidden', entries.length > 0);
  };

  const add = () => {
    const entry = { source: source.value.trim(), target: target.value.trim(), site: '' };
    if (!entry.source || !entry.target) {
      showCustomWarning(t('原文和譯文都要填。', 'Please fill in both the term and its translation.'));
      return;
    }
    if (site.value.trim()) {
      entry.site = SitePatterns.normalize(site.value);
      if (!entry.site) {
        showCustomWarning(t('看不懂這個網站，請輸入像 example.com 或 *.example.com 這樣的格式，或留空。',
          'Please enter a site like example.com or *.example.com, or leave it empty.'));
        return;
      }
    }
    load(entries => {
      // 同一個網站範圍裡，同樣的原文只留一筆（新的蓋掉舊的）
      const others = entries.filter(e => !(e.source === entry.source && (e.site || '') === entry.site));
      save([...others, entry]);
      source.value = '';
      target.value = '';
      source.focus();
    });
  };

  $('addGlossaryBtn').addEventListener('click', add);
  [source, target, site].forEach(input => input.addEventListener('keydown', e => {
    if (e.key === 'Enter') add();
  }));

  $('exportGlossaryBtn').addEventListener('click', () => {
    load(entries => downloadFile('coco-glossary.json', JSON.stringify(entries, null, 2)));
  });

  bindJsonImport('importGlossaryBtn', 'importGlossaryFile', imported => {
    if (!Array.isArray(imported)) {
      showCustomWarning(t('檔案格式不對，請選擇匯出的術語表 JSON。', 'Invalid file. Please choose an exported glossary JSON.'));
      return;
    }
    const valid = imported
      .filter(e => e && typeof e.source === 'string' && typeof e.target === 'string' && e.source.trim() && e.target.trim())
      .map(e => ({ source: e.source.trim(), target: e.target.trim(), site: e.site ? SitePatterns.normalize(e.site) || '' : '' }));
    load(entries => {
      const key = e => `${e.source}\u0000${e.site}`;
      const merged = new Map(entries.map(e => [key(e), e]));
      valid.forEach(e => merged.set(key(e), e));
      save([...merged.values()]);
      showCustomWarning(t(`已匯入 ${valid.length} 筆詞條。`, `Imported ${valid.length} entries.`));
    });
  });

  load(render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.glossary) render(changes.glossary.newValue || []);
  });
  onLanguageChange(() => render());
}

// ---------------- 生字本 ----------------
// Anki 匯入格式：Tab 分隔，開頭幾行告訴 Anki 怎麼讀（Anki 2.1.54 以後支援）
function toAnkiText(vocabulary) {
  const clean = value => String(value || '').replace(/[\t\r\n]+/g, ' ').trim();
  const lines = vocabulary.map(item =>
    [item.word, item.translation, item.phonetic, item.context, item.url].map(clean).join('\t'));
  return ['#separator:tab', '#html:false', '#columns:Word\tTranslation\tPhonetic\tContext\tSource', ...lines].join('\n') + '\n';
}

function initVocabulary() {
  const list = $('vocabularyList');
  let current = [];

  const render = (vocabulary = current) => {
    current = vocabulary;
    list.innerHTML = '';
    vocabulary.forEach(item => {
      const head = document.createElement('div');
      const word = document.createElement('strong');
      word.textContent = item.word;
      head.appendChild(word);
      if (item.phonetic) {
        const phonetic = document.createElement('span');
        phonetic.className = 'hint';
        phonetic.textContent = `  ${item.phonetic}`;
        head.appendChild(phonetic);
      }
      const translation = document.createElement('div');
      translation.textContent = item.translation || '';
      const nodes = [head, translation];
      if (item.context) {
        const context = document.createElement('div');
        context.className = 'hint';
        context.textContent = item.context;
        nodes.push(context);
      }
      if (item.url) {
        const link = document.createElement('a');
        link.className = 'hint';
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = item.title || item.url;
        nodes.push(link);
      }
      list.appendChild(createListItem(nodes, () => {
        chrome.storage.local.get(['vocabulary'], data => {
          chrome.storage.local.set({ vocabulary: (data.vocabulary || []).filter(v => v.word !== item.word) });
        });
      }));
    });
    $('vocabularyEmpty').classList.toggle('hidden', vocabulary.length > 0);
    $('vocabularyCount').textContent = vocabulary.length
      ? t(`共 ${vocabulary.length} 個字`, `${vocabulary.length} words`)
      : '';
  };

  $('exportAnkiBtn').addEventListener('click', () => {
    if (!current.length) {
      showCustomWarning(t('生字本還是空的。', 'Your vocabulary is empty.'));
      return;
    }
    downloadFile('coco-vocabulary.txt', toAnkiText(current), 'text/plain');
  });

  $('clearVocabularyBtn').addEventListener('click', () => {
    if (!current.length) return;
    if (!confirm(t(`確定要刪除全部 ${current.length} 個字嗎？`, `Delete all ${current.length} words?`))) return;
    chrome.storage.local.set({ vocabulary: [] });
  });

  chrome.storage.local.get(['vocabulary'], data => render(data.vocabulary || []));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.vocabulary) render(changes.vocabulary.newValue || []);
  });
  onLanguageChange(() => render());
}

// ---------------- 正規表達式 ----------------
function initRegex() {
  const list = $('patternList');
  let patterns = [];

  // 背景的 PostProcess 直接監聽 storage，存了就生效
  const save = () => chrome.storage.local.set({ regexPatterns: patterns });

  const render = () => {
    list.innerHTML = '';
    patterns.forEach((pattern, index) => {
      const toggle = document.createElement('span');
      toggle.className = 'switch';
      const enabled = document.createElement('input');
      enabled.type = 'checkbox';
      enabled.className = 'pattern-enabled';
      enabled.checked = !!pattern.enabled;
      enabled.addEventListener('change', () => {
        patterns[index].enabled = enabled.checked;
        save();
      });
      const slider = document.createElement('span');
      slider.className = 'slider';
      toggle.append(enabled, slider);

      const makeText = (className, placeholderKey, field) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = `text-input ${className}`;
        input.placeholder = i18n(placeholderKey);
        input.value = pattern[field] ?? '';
        input.addEventListener('change', () => {
          patterns[index][field] = input.value;
          save();
        });
        return input;
      };

      const row = document.createElement('div');
      row.className = 'inline';
      row.append(toggle, makeText('pattern-input', 'patternInput', 'input'), makeText('pattern-output', 'patternOutput', 'output'));
      list.appendChild(createListItem([row], () => {
        patterns.splice(index, 1);
        save();
      }, 'pattern-item'));
    });
    $('patternEmpty').classList.toggle('hidden', patterns.length > 0);
  };

  chrome.storage.local.get(['regexPatterns'], data => {
    patterns = data.regexPatterns || [];
    render();
  });
  // 自己存的時候也會觸發，重畫一次沒差（輸入框用 change 事件，打字中不會被洗掉）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.regexPatterns) {
      patterns = changes.regexPatterns.newValue || [];
      render();
    }
  });
  onLanguageChange(render);

  $('addPatternBtn').addEventListener('click', () => {
    patterns.push({ input: '', output: '', enabled: true });
    save();
  });

  $('exportRegex').addEventListener('click', () => {
    downloadFile('regex_patterns.json', JSON.stringify(patterns, null, 2));
  });

  bindJsonImport('importBtn', 'importFile', imported => {
    if (!Array.isArray(imported)) {
      showCustomWarning(t('檔案格式不對（不是陣列）。', 'Invalid JSON format (not an array).'));
      return;
    }
    patterns = imported;
    chrome.storage.local.set({ regexPatterns: imported }, () => {
      showCustomWarning(t(`已匯入 ${imported.length} 條規則！`, `Imported ${imported.length} patterns!`));
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  showSection(location.hash.slice(1));
  window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;

  // 先用預設語言畫一次，讀到設定後再換
  applyLanguage('zh');
  initGeneral();
  initSources();
  initSites();
  initGlossary();
  initVocabulary();
  initRegex();

  const setLanguage = lang => {
    applyLanguage(lang || 'zh');
    $('languageSelector').value = currentUiLang;
    languageListeners.forEach(listener => listener());
  };
  getStorageLang().then(setLanguage);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.myLang) setLanguage(changes.myLang.newValue);
  });
});
