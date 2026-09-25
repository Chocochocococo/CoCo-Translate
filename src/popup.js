// popup.js — 常用功能的快速面板；細項設定都搬到設定頁（options.html）了
// 這裡改什麼都馬上存，不用再按他媽的「儲存設定」

let activeTab = null;
let pageSupported = false;
let pageTranslated = false;
let pageShortcut = '';
let triggerKey = 'ControlRight';

const $ = id => document.getElementById(id);

// ---------------- 會跟著語言變的文字 ----------------
function renderPageButton() {
  const button = $('pageToggleBtn');
  button.disabled = !pageSupported;
  button.classList.toggle('translated', pageSupported && pageTranslated);
  $('pageToggleLabel').textContent = !pageSupported
    ? i18n('unsupportedPage')
    : i18n(pageTranslated ? 'restorePage' : 'translatePage');
  $('pageShortcut').textContent = pageSupported ? pageShortcut : '';
}

function renderThemeButton(mode) {
  const button = $('themeToggle');
  button.dataset.mode = mode;
  button.title = i18n({ auto: 'themeTitleAuto', light: 'themeTitleLight', dark: 'themeTitleDark' }[mode]);
  button.setAttribute('aria-label', button.title);
}

function renderTriggerHint() {
  $('triggerHint').textContent = i18n('mouseTriggerHint', { key: formatKeyCode(triggerKey) });
}

function renderDynamicText() {
  renderPageButton();
  renderThemeButton(CocoTheme.get());
  renderTriggerHint();
  refreshSourceWarning();
}

// ---------------- 翻譯來源警告（沒填金鑰、AI 整頁翻譯很燒額度） ----------------
async function refreshSourceWarning() {
  const warning = $('sourceWarning');
  const message = await checkAPIKey($('pageSource').value, true);
  warning.textContent = message;
  warning.classList.toggle('hidden', !message);
}

// ---------------- 目前分頁 ----------------
function initActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    activeTab = tabs[0] || null;
    let url = null;
    try {
      url = new URL(activeTab.url);
    } catch (e) {
      // 拿不到網址就算了
    }
    // chrome:// 、about: 這類頁面跑不了 content script
    pageSupported = !!url && /^https?:$/.test(url.protocol);
    $('siteHost').textContent = pageSupported ? url.hostname : '';
    $('alwaysTranslateHost').textContent = pageSupported ? url.hostname : '';
    renderPageButton();
    initAlwaysTranslate(url);
    if (!pageSupported) return;
    chrome.runtime.sendMessage({ type: 'GET_PAGE_STATUS', tabId: activeTab.id }, response => {
      if (chrome.runtime.lastError || !response) return;
      pageTranslated = !!response.isTranslated;
      renderPageButton();
    });
  });
}

function sendPageCommand(type) {
  chrome.tabs.sendMessage(activeTab.id, { type }, () => void chrome.runtime.lastError);
  chrome.runtime.sendMessage({ type, tabId: activeTab.id }, () => void chrome.runtime.lastError);
}

function initPageButton() {
  $('pageToggleBtn').addEventListener('click', () => {
    if (!pageSupported || !activeTab) return;
    sendPageCommand(pageTranslated ? 'RESTORE_PAGE' : 'TRANSLATE_PAGE');
    pageTranslated = !pageTranslated;
    renderPageButton();
  });

  // 快捷鍵顯示在按鈕上（使用者清空就不顯示）
  if (chrome.commands?.getAll) {
    chrome.commands.getAll(commands => {
      const command = (commands || []).find(c => c.name === 'toggle-page-translation');
      pageShortcut = command?.shortcut || '';
      renderPageButton();
    });
  }
}

// ---------------- 總是翻譯此網站（萬用字元規則也算） ----------------
function initAlwaysTranslate(url) {
  const checkbox = $('alwaysTranslateCheckbox');
  if (!pageSupported) {
    checkbox.disabled = true;
    return;
  }
  const origin = url.origin;
  chrome.storage.local.get(['siteTranslationList'], data => {
    checkbox.checked = !!SitePatterns.findMatch(data.siteTranslationList, activeTab.url);
  });
  checkbox.addEventListener('change', () => {
    const shouldTranslate = checkbox.checked;
    chrome.storage.local.get(['siteTranslationList'], data => {
      let siteList = data.siteTranslationList || [];
      if (shouldTranslate) {
        if (!siteList.includes(origin)) siteList.push(origin);
      } else {
        const exact = SitePatterns.exactEntriesFor(siteList, activeTab.url);
        siteList = siteList.filter(site => !exact.includes(site));
        // 還有萬用字元規則套用在這個網站 → 這裡拿不掉，請使用者到設定頁管理
        const stillMatched = SitePatterns.findMatch(siteList, activeTab.url);
        if (stillMatched) {
          checkbox.checked = true;
          showCustomWarning(currentUiLang === 'zh'
            ? `這個網站是由規則「${stillMatched}」套用的，請到設定頁的網站清單修改。`
            : `This site is covered by the rule "${stillMatched}". Edit it in the site list on the settings page.`);
          if (!exact.length) return;
        }
      }
      chrome.storage.local.set({ siteTranslationList: siteList }, () => {
        if (!shouldTranslate && SitePatterns.findMatch(siteList, activeTab.url)) return;
        // 勾選當下就直接翻譯、取消勾選就還原，不用再重新整理頁面
        sendPageCommand(shouldTranslate ? 'TRANSLATE_PAGE' : 'RESTORE_PAGE');
        pageTranslated = shouldTranslate;
        renderPageButton();
      });
    });
  });
}

// ---------------- 設定 ----------------
function initSettings() {
  bindSegmented('displayMode', 'pageDisplayMode', {
    defaultValue: 'replace',
    normalize: value => (value === 'bilingual' ? 'bilingual' : 'replace')
  });

  bindSelect('pageSource', 'pageTranslationSource', {
    defaultValue: 'google',
    normalize: normalizeSource,
    onChange: refreshSourceWarning
  });
  // 金鑰或 AI 設定在設定頁改了，警告也要跟著更新
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (['pageTranslationSource', 'googleApiKey', 'deepLApiKey', 'llmSettings'].some(key => key in changes)) {
      refreshSourceWarning();
    }
  });

  bindSelect('targetLanguage', 'targetLanguage', {
    defaultValue: 'zh-TW',
    onChange: language => chrome.runtime.sendMessage({ type: 'SET_TARGET_LANGUAGE', language })
  });

  // 背景會存 isEnabled、換圖示、通知所有分頁
  bindSwitch('toggleTranslation', 'isEnabled', {
    defaultValue: true,
    onChange: isEnabled => chrome.runtime.sendMessage({ type: 'TOGGLE_TRANSLATION', isEnabled })
  });
  chrome.storage.local.get(['triggerKey'], data => {
    triggerKey = data.triggerKey || 'ControlRight';
    renderTriggerHint();
  });

  bindSwitch('enableYouTubeSubtitles', 'enableYouTubeSubtitles');
  bindSegmented('youTubeSubtitleMode', 'youTubeSubtitleMode', {
    defaultValue: 'bilingual',
    normalize: value => (value === 'translation' ? 'translation' : 'bilingual')
  });
}

function initLinks() {
  $('openOptionsBtn').addEventListener('click', () => openOptionsPage());
  $('openGlossaryBtn').addEventListener('click', () => openOptionsPage('glossary'));
  $('openVocabularyBtn').addEventListener('click', () => openOptionsPage('vocabulary'));
  $('manageSitesBtn').addEventListener('click', () => openOptionsPage('sites'));
  $('clearBtn').addEventListener('click', () => {
    chrome.tabs.query({}, tabs => tabs.forEach(tab =>
      chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_ALL_TRANSLATIONS' }, () => void chrome.runtime.lastError)));
  });
  $('themeToggle').addEventListener('click', () => CocoTheme.cycle());
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
}

document.addEventListener('DOMContentLoaded', () => {
  initLinks();
  initPageButton();
  initSettings();
  initActiveTab();
  CocoTheme.onChange(renderThemeButton);

  getStorageLang().then(lang => {
    applyLanguage(lang || 'zh');
    renderDynamicText();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.myLang) {
      applyLanguage(changes.myLang.newValue || 'zh');
      renderDynamicText();
    }
  });
});
