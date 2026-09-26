// ui.js — popup 跟設定頁共用的小工具（提示視窗、開關、切換鈕、API 金鑰檢查）
"use strict";

function showCustomWarning(message) {
  // 已經有提示窗就換文字重用，別他媽疊一堆
  let modal = document.getElementById('custom-warning-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'custom-warning-modal';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    const paragraph = document.createElement('p');
    const okButton = document.createElement('button');
    okButton.className = 'btn';
    okButton.addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.add('hidden');
    });
    dialog.append(paragraph, okButton);
    modal.appendChild(dialog);
    document.body.appendChild(modal);
  }
  modal.querySelector('p').textContent = message;
  modal.querySelector('button').textContent = i18n('ok');
  modal.classList.remove('hidden');
  modal.querySelector('button').focus();
}

// 開關：checkbox 讀 storage、改了就存（onChange 可以另外做事）
function bindSwitch(id, key, { defaultValue = false, onChange } = {}) {
  const input = document.getElementById(id);
  if (!input) return null;
  chrome.storage.local.get([key], data => {
    input.checked = data[key] === undefined ? defaultValue : data[key] === true;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) {
      const value = changes[key].newValue;
      input.checked = value === undefined ? defaultValue : value === true;
    }
  });
  input.addEventListener('change', () => {
    chrome.storage.local.set({ [key]: input.checked });
    onChange?.(input.checked);
  });
  return input;
}

// 下拉選單：讀 storage、改了就存
function bindSelect(id, key, { defaultValue, normalize = v => v, onChange } = {}) {
  const select = document.getElementById(id);
  if (!select) return null;
  const show = value => {
    const normalized = normalize(value ?? defaultValue);
    if ([...select.options].some(o => o.value === String(normalized))) select.value = normalized;
  };
  chrome.storage.local.get([key], data => show(data[key]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) show(changes[key].newValue);
  });
  select.addEventListener('change', () => {
    chrome.storage.local.set({ [key]: select.value });
    onChange?.(select.value);
  });
  return select;
}

// 切換鈕（<div class="segmented"><button data-value>…）：讀 storage、點了就存
function bindSegmented(id, key, { defaultValue, normalize = v => v, onChange } = {}) {
  const group = document.getElementById(id);
  if (!group) return null;
  const buttons = [...group.querySelectorAll('button[data-value]')];
  const show = value => {
    const normalized = normalize(value ?? defaultValue);
    buttons.forEach(button => {
      const on = button.dataset.value === normalized;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };
  chrome.storage.local.get([key], data => show(data[key]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[key]) show(changes[key].newValue);
  });
  buttons.forEach(button => button.addEventListener('click', () => {
    show(button.dataset.value);
    chrome.storage.local.set({ [key]: button.dataset.value });
    onChange?.(button.dataset.value);
  }));
  return group;
}

// 外觀切換鈕（設定頁用）：直接接 CocoTheme
function bindThemeSegmented(id) {
  const group = document.getElementById(id);
  if (!group) return;
  const buttons = [...group.querySelectorAll('button[data-value]')];
  CocoTheme.onChange(mode => buttons.forEach(button => {
    const on = button.dataset.value === mode;
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', String(on));
  }));
  buttons.forEach(button => button.addEventListener('click', () => CocoTheme.set(button.dataset.value)));
}

// KeyboardEvent.code → 人看得懂的名字（ControlRight → Right Ctrl）
function formatKeyCode(code) {
  if (!code) return '';
  const sides = code.match(/^(Control|Alt|Shift|Meta)(Left|Right)$/);
  if (sides) {
    const name = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Meta: 'Win/⌘' }[sides[1]];
    return `${sides[2]} ${name}`;
  }
  return code.replace(/^Key/, '').replace(/^Digit/, '');
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

// YouTube 影片上的字幕：雙語／只譯文／只原文／不顯示（只看字幕側欄）
const normalizeYouTubeMode = mode => (['translation', 'original', 'none'].includes(mode) ? mode : 'bilingual');

// 舊版的 mistral-api 現在歸到 AI (LLM)
const normalizeSource = source => (source === 'mistral-api' ? 'llm' : source || 'google');

// 檢查選擇的翻譯來源是否已儲存對應的 API key，回傳警告訊息（沒問題就回傳空字串）
function checkAPIKey(selectedSource, isPage) {
  return new Promise(resolve => {
    if (selectedSource === 'google-api') {
      chrome.storage.local.get(['googleApiKey'], data => resolve(data.googleApiKey ? '' : i18n('needGoogleKey')));
    } else if (selectedSource === 'deepl-api') {
      chrome.storage.local.get(['deepLApiKey'], data => resolve(data.deepLApiKey ? '' : i18n('needDeepLKey')));
    } else if (selectedSource === 'llm') {
      loadLLMSettings(settings => {
        const config = settings.providers[settings.provider] || {};
        const warnings = [];
        if (LLM_PROVIDERS_NEED_KEY.includes(settings.provider) && !config.apiKey) warnings.push(i18n('needLlmKey'));
        if (isPage && settings.provider !== 'ollama-local' && settings.provider !== 'custom') warnings.push(i18n('llmPageWarning'));
        resolve(warnings.join('\n'));
      });
    } else {
      resolve('');
    }
  });
}

// 兩個翻譯來源一起檢查，重複的警告只留一個
async function sourceWarnings(triggerSource, pageSource) {
  const warnings = [await checkAPIKey(triggerSource, false), await checkAPIKey(pageSource, true)];
  return [...new Set(warnings.filter(Boolean))].join('\n');
}

function openOptionsPage(section = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${section ? '#' + section : ''}`) });
}
