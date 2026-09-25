// content.js
let isEnabled = true,
    enableSelectionButton = true,
    targetLanguage = 'zh-TW',
    isPageTranslationMode = false,
    isRestoring = false,
    showOriginalTooltip = true,
    inputTargetLanguage = 'en';
let currentHoveredElement = null,
    isRightCtrlPressed = false;
let translationMap = new WeakMap(),
    suppressTranslationMap = new WeakMap(),
    originalTextMap = new WeakMap(),
    originalTextareaMap = new WeakMap(),
    originalAttributesMap = new WeakMap();
let allTranslations = new Set(),
    pendingNodes = [];
let debounceTimer = null,
    pageTranslationObserver = null,
    originalTextTooltip = null;
let translatedTextMap = new WeakMap(); // 我們自己寫進去的譯文，用來避免重複翻譯
let triggerKey = 'ControlRight';
let selectionTranslationButton, floatingButton, inputBox, translationBox, translationBoxContent, tooltip, translateBtn;
let cursorPosition = { x: 0, y: 0 };

chrome.storage.local.get(['isEnabled', 'targetLanguage', 'triggerKey', 'enableSelectionButton', 'showOriginalTooltip'], data => {
  isEnabled = data.isEnabled ?? true;
  targetLanguage = data.targetLanguage || 'zh-TW';
  triggerKey = data.triggerKey || 'ControlRight';
  enableSelectionButton = data.enableSelectionButton !== false;
  showOriginalTooltip = data.showOriginalTooltip !== false;
});

// Utility functions
const removeAllTranslations = () => {
  allTranslations.forEach(container => container?.remove());
  allTranslations.clear();
  translationMap = new WeakMap();
  suppressTranslationMap = new WeakMap();
};

const suppressTranslation = target => {
  suppressTranslationMap.set(target, true);
  setTimeout(() => suppressTranslationMap.delete(target), 100);
};

const copyElementStyles = (source, target) => {
  const computed = window.getComputedStyle(source);
  ['color', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'textDecoration', 'fontStyle', 'wordSpacing', 'textTransform', 'whiteSpace', 'margin', 'padding', 'display', 'verticalAlign']
    .forEach(prop => target.style[prop] = computed[prop]);
  Array.from(source.children).forEach((child, i) => {
    let targetChild = target.children[i] || document.createElement(child.tagName);
    if (!target.children[i]) target.appendChild(targetChild);
    copyElementStyles(child, targetChild);
  });
};

const getClosestContentContainer = target => {
  const tags = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'section', 'article'];
  return tags.map(tag => target.closest(tag)).find(el => el) || null;
};

function getContainerOriginalText(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let text = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    text += originalTextMap.has(node) ? originalTextMap.get(node) : node.textContent;
  }
  return text;
}

// ---------------- 翻譯請求：全部交給 background ----------------
const ERROR_MESSAGES = {
  zh: {
    auth: 'API 金鑰錯誤或尚未設定',
    quota: '額度用完或請求太頻繁，請稍後再試',
    config: '翻譯設定不完整',
    network: '連線失敗',
    bad_response: '翻譯服務回傳了看不懂的內容',
    http: '翻譯服務發生錯誤',
    unknown: '翻譯失敗'
  },
  en: {
    auth: 'API key is invalid or missing',
    quota: 'Quota exceeded or too many requests, please try again later',
    config: 'Translation settings are incomplete',
    network: 'Network error',
    bad_response: 'Unexpected response from the translation service',
    http: 'Translation service error',
    unknown: 'Translation failed'
  }
};

let uiLanguage = 'zh';
chrome.storage.local.get(['myLang'], data => {
  uiLanguage = data.myLang || 'zh';
});

const describeError = error => {
  const dict = ERROR_MESSAGES[uiLanguage] || ERROR_MESSAGES.en;
  const title = dict[error.code] || dict.unknown;
  return `${error.provider ? error.provider + '：' : ''}${title}`;
};

// 同樣的錯誤 10 秒內只提示一次，別整頁翻譯時噴一百個
let errorToast = null;
let errorToastTimer = null;
const recentErrors = new Map();
const showTranslationError = error => {
  const key = `${error.provider}|${error.code}`;
  if (Date.now() - (recentErrors.get(key) || 0) < 10000) return;
  recentErrors.set(key, Date.now());

  if (!errorToast) {
    errorToast = document.createElement('div');
    errorToast.id = 'coco-error-toast';
    Object.assign(errorToast.style, {
      position: 'fixed',
      right: '20px',
      bottom: '70px',
      maxWidth: '360px',
      padding: '10px 14px',
      background: 'rgba(160, 30, 30, 0.92)',
      color: '#fff',
      borderRadius: '8px',
      fontSize: '13px',
      lineHeight: '1.4',
      zIndex: '10004',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      cursor: 'pointer'
    });
    errorToast.addEventListener('click', () => { errorToast.style.display = 'none'; });
    document.body.appendChild(errorToast);
  }
  errorToast.textContent = `CoCo Translate\n${describeError(error)}\n${error.message || ''}`.trim();
  errorToast.style.display = 'block';
  clearTimeout(errorToastTimer);
  errorToastTimer = setTimeout(() => { errorToast.style.display = 'none'; }, 8000);
};

/**
 * 把一批文字丟給 background 翻譯
 * @returns {Promise<{translations: string[], error: Object|null}>}
 */
const requestTranslations = (role, texts, targetLang = targetLanguage) => new Promise(resolve => {
  if (!texts.length) return resolve({ translations: [], error: null });
  const fail = message => {
    const error = { code: 'network', message, provider: '' };
    showTranslationError(error);
    resolve({ translations: texts, error });
  };
  try {
    chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', role, texts, targetLang }, response => {
      if (chrome.runtime.lastError || !response) {
        console.error('Fuck, 翻譯請求失敗:', chrome.runtime.lastError);
        return fail(chrome.runtime.lastError?.message || 'No response from background');
      }
      if (response.error) showTranslationError(response.error);
      resolve({ translations: response.translations || texts, error: response.error || null });
    });
  } catch (e) {
    // 擴充功能被重新載入後，舊頁面的 content script 會跟 background 斷線
    fail('Extension was reloaded, please refresh this page');
  }
});

const PAGE_BATCH_ITEMS = 60;
const PAGE_BATCH_CHARS = 6000;
const PAGE_BATCH_CONCURRENCY = 3;

/**
 * jobs: [{ text, apply(translated) }]
 * 分批送出，每批翻完先套用，畫面才不用等全部翻完才動
 */
async function translateJobs(role, jobs, targetLang = targetLanguage) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const job of jobs) {
    if (current.length && (current.length >= PAGE_BATCH_ITEMS || chars + job.text.length > PAGE_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(job);
    chars += job.text.length;
  }
  if (current.length) batches.push(current);

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      const { translations } = await requestTranslations(role, batch.map(job => job.text), targetLang);
      batch.forEach((job, i) => {
        try {
          job.apply(translations[i]);
        } catch (e) {
          console.error('套用譯文失敗:', e);
        }
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PAGE_BATCH_CONCURRENCY, batches.length) }, worker));
}

// 保留前後空白，不然 "Hello <b>world</b>" 翻完會黏在一起
const splitWhitespace = text => {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return { lead: match[1], core: match[2], trail: match[3] };
};

// 這些標籤裡的文字不是給人看的，翻了反而會弄壞網頁（textarea 另外用 value 翻）
// 程式碼區塊、編輯器、translate="no" 都照翻：CoCo 是使用者自己按下去才翻的
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA']);
// CoCo 自己的介面
const SKIP_SELECTOR = [
  '.immersive-translation-container', '#custom-context-menu', '#input-box', '#translation-box',
  '#original-text-tooltip', '#copy-tooltip', '#coco-error-toast'
].join(', ');

// 使用者正在這個編輯器裡打字嗎？（游標在裡面）
const isBeingEdited = node => {
  const active = document.activeElement;
  return !!active && active.isContentEditable && active.contains(node);
};

/**
 * @param {Node} node
 * @param {boolean} fromMutation 由網頁變動觸發（不是使用者按下整頁翻譯）
 */
const shouldSkipTextNode = (node, fromMutation = false) => {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return true;
  // 編輯器裡原本的文字照翻；但使用者正在打字時，別把剛打的字翻掉
  if (fromMutation && parent.isContentEditable && isBeingEdited(node)) return true;
  return !!parent.closest(SKIP_SELECTOR);
};

// Translation functions
function collectTextareaJobs() {
  const jobs = [];
  document.querySelectorAll('textarea').forEach(textarea => {
    if (textarea === inputBox) return;
    const value = textarea.value;
    if (!value.trim()) return;
    // 已經翻過（內容不是原文了）就跳過
    if (originalTextareaMap.has(textarea) && originalTextareaMap.get(textarea) !== value) return;
    originalTextareaMap.set(textarea, value);
    jobs.push({
      text: value.trim(),
      apply: translated => {
        if (isPageTranslationMode && textarea.value === value) textarea.value = translated;
      }
    });
  });
  return jobs;
}

const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'display-name', 'description'];

function collectAttributeJobs() {
  const jobs = [];
  document.querySelectorAll('[placeholder], [title], [display-name], [description]').forEach(element => {
    if (element.closest(SKIP_SELECTOR)) return;
    if (!originalAttributesMap.has(element)) originalAttributesMap.set(element, {});
    const originals = originalAttributesMap.get(element);
    TRANSLATABLE_ATTRIBUTES.forEach(attr => {
      const value = element.getAttribute(attr);
      if (!value || !value.trim()) return;
      if (attr in originals && originals[attr] !== value) return;   // 已經翻過
      originals[attr] = value;
      jobs.push({
        text: value.trim(),
        apply: translated => {
          if (isPageTranslationMode && element.getAttribute(attr) === value) element.setAttribute(attr, translated);
        }
      });
    });
  });
  return jobs;
}

// 收集要整頁翻譯的文字節點，並記下原文
function collectPageTextJobs(root, { fromMutation = false } = {}) {
  const jobs = [];
  if (!root) return jobs;
  const nodes = root.nodeType === Node.TEXT_NODE ? [root] : [];
  if (root.nodeType === Node.ELEMENT_NODE) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    while (walker.nextNode()) nodes.push(walker.currentNode);
  }
  for (const node of nodes) {
    const text = node.textContent;
    if (!text.trim() || shouldSkipTextNode(node, fromMutation)) continue;
    // 這是我們自己翻好寫進去的，別再翻一次
    if (translatedTextMap.get(node) === text) continue;
    // 第一次看到、或網頁自己改了內容 → 現在的文字就是原文
    originalTextMap.set(node, text);
    const { lead, core, trail } = splitWhitespace(text);
    jobs.push({
      text: core,
      apply: translated => {
        // 翻譯途中被還原、或被網頁改掉了，就別蓋上去
        if (!isPageTranslationMode || node.textContent !== text) return;
        const result = lead + translated + trail;
        translatedTextMap.set(node, result);
        node.textContent = result;
      }
    });
  }
  return jobs;
}

const handleTranslation = async target => {
  if (!isEnabled || !target || target.closest('.immersive-translation-container')) return;
  const container = getClosestContentContainer(target);
  if (!container || suppressTranslationMap.has(container)) return;

  if (!container.dataset.originalText) {
    container.dataset.originalText = container.innerText;
  }

  if (translationMap.has(container)) {
    translationMap.get(container).remove();
    allTranslations.delete(translationMap.get(container));
    translationMap.delete(container);
    suppressTranslation(container);
    return;
  }
  // 插入 loading 圖示，讓原文下方顯示 "loading.gif"
  const loadingIndicator = document.createElement('img');
  loadingIndicator.src = chrome.runtime.getURL('icons/loading.gif');
  loadingIndicator.className = 'loading-indicator';
  Object.assign(loadingIndicator.style, {
    display: 'block',
    marginTop: '10px',
    width: '24px',
    height: '24px'
  });
  container.parentNode.insertBefore(loadingIndicator, container.nextSibling);
  
  // 開始翻譯前，顯示 loading，真他媽的讓人安心
  const translationHTML = await translateHTMLStructure(container.innerHTML);
  
  // 翻譯結束，移除 loading 圖示
  loadingIndicator.remove();

  if (translationHTML) {
    const transContainer = document.createElement('div');
    transContainer.className = 'immersive-translation-container';
    transContainer.innerHTML = translationHTML;
    copyElementStyles(container, transContainer);
    container.parentNode.insertBefore(transContainer, container.nextSibling);
    translationMap.set(container, transContainer);
    allTranslations.add(transContainer);
  }
};

const translateHTMLStructure = async html => {
  const container = document.createElement('div');
  container.innerHTML = html;
  const nodes = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim() || SKIP_TAGS.has(node.parentElement?.tagName)) continue;
    nodes.push(node);
  }
  if (!nodes.length) return container.innerHTML;

  const parts = nodes.map(node => splitWhitespace(node.textContent));
  const role = isPageTranslationMode ? 'page' : 'trigger';
  const { translations, error } = await requestTranslations(role, parts.map(part => part.core), targetLanguage);
  // 全部失敗就別插一份跟原文一模一樣的東西
  if (error && translations.every((t, i) => t === parts[i].core)) return null;

  nodes.forEach((node, i) => {
    node.textContent = parts[i].lead + translations[i] + parts[i].trail;
  });
  return container.innerHTML;
};

const translatePage = async () => {
  isRestoring = false;
  isPageTranslationMode = true;
  hideTranslationButton();
  startAutoTranslationObserver();
  const jobs = [
    ...collectPageTextJobs(document.body),
    ...collectTextareaJobs(),
    ...collectAttributeJobs()
  ];
  await translateJobs('page', jobs, targetLanguage);
};

const restorePage = () => {
  disableAutoTranslation();
  removeAllTranslations();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (originalTextMap.has(node)) {
      node.textContent = originalTextMap.get(node);
    };
  };
 const textareas = document.querySelectorAll('textarea');
 textareas.forEach(textarea => {
   if (originalTextareaMap.has(textarea)) {
     textarea.value = originalTextareaMap.get(textarea);
   }
 });
 const allElements = document.querySelectorAll('[placeholder], [title], [display-name], [description]');
 allElements.forEach(el => {
   if (originalAttributesMap.has(el)) {
     const attrObj = originalAttributesMap.get(el);
     for (const attrName in attrObj) {
       el.setAttribute(attrName, attrObj[attrName]);
     }
   }
 });
 // 還原完就忘掉，下次整頁翻譯重新開始
 translatedTextMap = new WeakMap();
 originalTextareaMap = new WeakMap();
 originalAttributesMap = new WeakMap();
};

const disableAutoTranslation = () => {
  isPageTranslationMode = false;
  isRestoring = true;
  stopAutoTranslationObserver();
}

// Page Translate Show OriginalTEXT
function createOriginalTextTooltip() {
  if (!originalTextTooltip) {
    originalTextTooltip = document.createElement('div');
    originalTextTooltip.id = 'original-text-tooltip';
    Object.assign(originalTextTooltip.style, {
      position: 'absolute',
      zIndex: '10000',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#fff',
      padding: '5px 8px',
      borderRadius: '5px',
      fontSize: '12px',
      maxWidth: '300px',
      wordWrap: 'break-word',
      display: 'none',
      pointerEvents: 'none'
    });
    document.body.appendChild(originalTextTooltip);
  }
}

function showOriginalTextTooltip(text, x, y) {
  createOriginalTextTooltip();
  originalTextTooltip.textContent = text;
  originalTextTooltip.style.left = `${x}px`;
  originalTextTooltip.style.top = `${y}px`;
  originalTextTooltip.style.display = 'block';
}

function hideOriginalTextTooltip() {
  if (originalTextTooltip) {
    originalTextTooltip.style.display = 'none';
  }
}

// Mutation Observer
const startAutoTranslationObserver = () => {
  stopAutoTranslationObserver();
  // 觀察到新節點或文字
  pageTranslationObserver = new MutationObserver(mutations => {
  if (isRestoring) return;
  for (const mutation of mutations) {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(node => {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          !node.classList?.contains('immersive-translation-container') &&
          !node.parentElement?.closest('.immersive-translation-container')
        ) {
          pendingNodes.push(node);
        }
      });
    } else if (mutation.type === 'characterData') {
      if (!mutation.target.parentElement?.closest('.immersive-translation-container' )) {
        pendingNodes.push(mutation.target);
      }
    }
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    const nodes = [...pendingNodes];
    pendingNodes = [];
    const jobs = nodes.filter(node => node.isConnected).flatMap(node => collectPageTextJobs(node, { fromMutation: true }));
    await translateJobs('page', jobs, targetLanguage);
  }, 300);
  });
  pageTranslationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
};

const stopAutoTranslationObserver = () => {
  if (pageTranslationObserver) {
    pageTranslationObserver.disconnect();
    pageTranslationObserver = null;
  }
  pendingNodes = [];
  clearTimeout(debounceTimer);
};

// Message listener
chrome.runtime.onMessage.addListener(message => {
  switch (message.type) {
    case "TOGGLE_TRANSLATION":
      isEnabled = message.isEnabled;
      if (!isEnabled) removeAllTranslations();
      break;
    case "UPDATE_TARGET_LANGUAGE":
      targetLanguage = message.targetLanguage;
      break;
    case "TRANSLATE_SELECTION":
      if (!isPageTranslationMode && window.getSelection().rangeCount) {
        const range = window.getSelection().getRangeAt(0);
        const selElem = range.commonAncestorContainer.nodeType === 3 ?
          range.commonAncestorContainer.parentElement :
          range.commonAncestorContainer;
        if (selElem) handleTranslation(selElem);
      }
      break;
    case "CLEAR_ALL_TRANSLATIONS":
      removeAllTranslations();
      break;
    case "TRANSLATE_PAGE":
      translatePage();
      break;
    case "RESTORE_PAGE":
      restorePage();
      break;
    case "DISABLE_AUTO_TRANSLATION":
      disableAutoTranslation();
      break;
  }
});

// Mouse and keyboard events
document.addEventListener('mouseover', e => {
  if (!isEnabled || isPageTranslationMode) return;
  currentHoveredElement = e.target;
  if (isRightCtrlPressed) handleTranslation(currentHoveredElement);
});
document.addEventListener('mouseout', () => currentHoveredElement = null);
document.addEventListener('mousemove', e => {
  cursorPosition = { x: e.clientX, y: e.clientY };
  if (isPageTranslationMode && showOriginalTooltip) {
    const container = getClosestContentContainer(e.target);
    if (container) {
      const tagName = container.tagName.toLowerCase();
      if (tagName === 'body' || tagName === 'html') {
        hideOriginalTextTooltip();
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width > window.innerWidth * 0.9 || rect.height > window.innerHeight * 0.9) {
        hideOriginalTextTooltip();
        return;
      }
      if (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      ) {
        if (!container.dataset.originalText) {
          const origText = getContainerOriginalText(container);
          container.dataset.originalText = origText;
        }
        if (container.dataset.originalText && container.dataset.originalText.trim() !== '') {
          showOriginalTextTooltip(container.dataset.originalText, e.pageX + 50, e.pageY + 10);
        } else {
          hideOriginalTextTooltip();
        }
      } else {
        hideOriginalTextTooltip();
      }
    } else {
      hideOriginalTextTooltip();
    }
  } else {
    hideOriginalTextTooltip();
  }
});

document.addEventListener('keydown', async e => {
  if (!isEnabled || isPageTranslationMode) return;
  if (e.code === triggerKey && !isRightCtrlPressed) {
    e.preventDefault();
    isRightCtrlPressed = true;
    if (currentHoveredElement) await handleTranslation(currentHoveredElement);
    isRightCtrlPressed = false;
  }
});
document.addEventListener('keyup', e => {
  if (e.code === triggerKey) isRightCtrlPressed = false;
});


// Selection translation button
const createTranslationButton = () => {
  if (!selectionTranslationButton) {
    selectionTranslationButton = document.createElement('button');
    selectionTranslationButton.innerHTML = `<img src="${chrome.runtime.getURL('icons/translation.png')}" style="width:24px;height:24px;" />`;
    Object.assign(selectionTranslationButton.style, {
      position: 'absolute',
      zIndex: '10000',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      display: 'none'
    });
    selectionTranslationButton.addEventListener('click', async () => {
      if (!isPageTranslationMode && window.getSelection().rangeCount) {
        const range = window.getSelection().getRangeAt(0);
        const selElem = range.commonAncestorContainer.nodeType === 3 ?
          range.commonAncestorContainer.parentElement :
          range.commonAncestorContainer;
        if (selElem) {
          hideTranslationButton();
          await handleTranslation(selElem);
        }
      }
    });
    document.body.appendChild(selectionTranslationButton);
  }
};

const showTranslationButton = () => {
  if (!isEnabled || isPageTranslationMode || !enableSelectionButton) return;
  const sel = window.getSelection();
  if (sel.rangeCount && !sel.isCollapsed) {
    createTranslationButton();
    selectionTranslationButton.style.left = `${cursorPosition.x + 20 + window.scrollX}px`;
    selectionTranslationButton.style.top = `${cursorPosition.y - 40 + window.scrollY}px`;
    selectionTranslationButton.style.display = 'block';
  }
};

const hideTranslationButton = () => {
  if (selectionTranslationButton) selectionTranslationButton.style.display = 'none';
};

document.addEventListener('mouseup', showTranslationButton);
document.addEventListener('mousedown', e => {
  if (selectionTranslationButton && !selectionTranslationButton.contains(e.target)) hideTranslationButton();
});

// Floating button and translation boxes
const getStoredPosition = () => {
  return new Promise((resolve) => {
    chrome.storage.local.get('floatingButtonPos', (result) => {
      if (chrome.runtime.lastError) {
        console.error("Fuck, getStoredPosition error:", chrome.runtime.lastError);
        return resolve(null);
      }
      resolve(result.floatingButtonPos || null);
    });
  });
};

// 非同步儲存按鈕位置
const storePosition = (left, top) => {
  // 轉換為相對百分比
  const leftPercent = left / window.innerWidth;
  const topPercent = top / window.innerHeight;
  chrome.storage.local.set({ floatingButtonPos: { leftPercent, topPercent } }, () => {
    if (chrome.runtime.lastError) {
      console.error("Fuck, storePosition error:", chrome.runtime.lastError);
    }
  });
};

const updateFloatingButton = async enabled => {
  if (window.top !== window.self) {
    console.log("他媽的，我在 iframe 裡，不顯示懸浮按鈕！");
    return;
  }
  if (enabled) {
    if (!floatingButton) await createFloatingButton();
  } else {
    if (floatingButton) {
      floatingButton.remove();
      floatingButton = null;
    }
  }
};

const createFloatingButton = async () => {
  floatingButton = document.createElement('button');
  floatingButton.id = 'floating-translate-btn';
  
  const storedPos = await getStoredPosition();
  const btnWidth = 32, btnHeight = 32;
  let initialLeft, initialTop;
  if (storedPos) {
    // 根據目前 viewport 的尺寸計算絕對位置
    initialLeft = storedPos.leftPercent * window.innerWidth;
    initialTop = storedPos.topPercent * window.innerHeight;
  } else {
    initialLeft = window.innerWidth - 20 - btnWidth;
    initialTop = window.innerHeight - 20 - btnHeight;
  }
  
  Object.assign(floatingButton.style, {
    position: 'fixed',
    left: initialLeft + 'px',
    top: initialTop + 'px',
    width: btnWidth + 'px',
    height: btnHeight + 'px',
    borderRadius: '50%',
    border: 'none',
    background: `url('${chrome.runtime.getURL('icons/inputtrans.png')}') no-repeat center`,
    backgroundSize: 'contain',
    opacity: '0.1',
    cursor: 'pointer',
    zIndex: '10000',
    transition: 'opacity 0.3s'
  });

  // 拖曳邏輯
  let isDragging = false;
  let startX, startY;
  let origLeft, origTop;
  
  floatingButton.addEventListener('mousedown', e => {
    e.preventDefault();
    isDragging = false; // 重置
    startX = e.clientX;
    startY = e.clientY;
    const rect = floatingButton.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    
    const onMouseMove = e => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 3) {
        isDragging = true; // 超過閥值才算拖曳
      }
      if (isDragging) {
        let newLeft = origLeft + dx;
        let newTop = origTop + dy;
        const btnRect = floatingButton.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        // 保證不超出邊界
        newLeft = Math.max(0, Math.min(newLeft, winWidth - btnRect.width));
        newTop = Math.max(0, Math.min(newTop, winHeight - btnRect.height));
        floatingButton.style.left = newLeft + 'px';
        floatingButton.style.top = newTop + 'px';
        updateComponentsPosition(newLeft, newTop);
      }
    };
    
    const onMouseUp = e => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (isDragging) {
        // 拖曳結束，存下新位置
        const rect = floatingButton.getBoundingClientRect();
        storePosition(rect.left, rect.top);
      } else {
        // 沒拖曳，當作點擊：切換彈窗
        toggleTranslationBoxes();
      }
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  floatingButton.addEventListener('mouseenter', () => floatingButton.style.opacity = '1');
  floatingButton.addEventListener('mouseleave', () => floatingButton.style.opacity = '0.2');
  document.body.appendChild(floatingButton);
};

const updateComponentsPosition = (btnLeft, btnTop) => {
  const offset = 10;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  const btnSize = 32; // 懸浮按鈕、翻譯按鈕、複製按鈕尺寸
  
  // 組1（翻譯按鈕 & 複製按鈕）尺寸
  const group1Height = btnSize * 2 + offset; // 32 + offset + 32
  // 組2（輸入框 & 翻譯框）尺寸
  const inputBoxWidth = 350;
  const inputBoxHeight = 60;
  const translationBoxHeight = 100;
  
  // ----- 決定組1位置（翻譯按鈕 & 複製按鈕） -----
  let group1Above = true; // 預設放上方
  if (btnTop - offset - group1Height < 0) {
    group1Above = false;
  }
  let translateBtnLeft = btnLeft;
  let translateBtnTop, copyBtnTop;
  if (group1Above) {
    translateBtnTop = btnTop - offset - btnSize;  
    copyBtnTop = translateBtnTop - offset - btnSize; 
  } else {
    translateBtnTop = btnTop + btnSize + offset;  
    copyBtnTop = translateBtnTop + btnSize + offset;
    if (copyBtnTop + btnSize > winHeight) {
      copyBtnTop = winHeight - btnSize;
    }
  }
  
  if (translateBtn) {
    translateBtn.style.left = translateBtnLeft + 'px';
    translateBtn.style.top = translateBtnTop + 'px';
  }
  
  const copyButton = document.getElementById('copy-button');
  if (copyButton) {
    copyButton.style.left = translateBtnLeft + 'px';
    copyButton.style.top = copyBtnTop + 'px';
  }
  
  // ----- 決定組2位置（輸入框 & 翻譯框）-----
  let group2Right = true; 
  if (btnLeft + btnSize + offset + inputBoxWidth > winWidth) {
    group2Right = false;
  }
  let inputBoxLeft;
  if (group2Right) {
    inputBoxLeft = btnLeft + btnSize + offset;
  } else {
    inputBoxLeft = btnLeft - offset - inputBoxWidth;
    if (inputBoxLeft < 0) inputBoxLeft = 0;
  }
  
  let inputBoxTop = btnTop;
  if (inputBoxTop + inputBoxHeight > winHeight) {
    inputBoxTop = winHeight - inputBoxHeight;
  }
  
  if (inputBox) {
    inputBox.style.left = inputBoxLeft + 'px';
    inputBox.style.top = inputBoxTop + 'px';
  }
  
  let translationBoxLeft = inputBoxLeft;
  let translationBoxTop = inputBoxTop - offset - translationBoxHeight;
  if (translationBoxTop < 0) {
    translationBoxTop = inputBoxTop + inputBoxHeight + offset;
    if (translationBoxTop + translationBoxHeight > winHeight) {
      translationBoxTop = winHeight - translationBoxHeight;
    }
  }
  
  if (translationBox) {
    translationBox.style.left = translationBoxLeft + 'px';
    translationBox.style.top = translationBoxTop + 'px';
  }
};

let outsideClickListenerAttached = false;
const setupOutsideClickListener = () => {
  // 懸浮按鈕關掉再打開會重建一次，監聽器只掛一次就好
  if (outsideClickListenerAttached) return;
  outsideClickListenerAttached = true;
  document.addEventListener('click', e => {
    if (
      (!inputBox || !inputBox.contains(e.target)) &&
      (!translationBox || !translationBox.contains(e.target)) &&
      (!floatingButton || !floatingButton.contains(e.target)) &&
      (!document.getElementById('copy-button') || !document.getElementById('copy-button').contains(e.target)) &&
      (!translateBtn || !translateBtn.contains(e.target))
    ) {
      hideTranslationBoxes();
      toggleCopyButton(false);
    }
  });
};

const toggleCopyButton = isVisible => {
  const copyButton = document.getElementById('copy-button');
  if (!copyButton) return;
  if (isVisible) {
    copyButton.style.display = 'block';
    setTimeout(() => {
      copyButton.style.opacity = '1';
    }, 10);
  } else {
    copyButton.style.opacity = '0';
    setTimeout(() => copyButton.style.display = 'none', 300);
  }
};

const createCopyButton = () => {
  const copyButton = document.createElement('button');
  copyButton.id = 'copy-button';
  Object.assign(copyButton.style, {
    position: 'fixed',
    top: '20px',
    left: '20px',
    width: '32px',
    height: '32px',
    background: `url('${chrome.runtime.getURL('icons/copy.png')}') no-repeat center`,
    backgroundSize: 'contain',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'none',
    zIndex: '10002',
    transition: 'top 0.3s, opacity 0.3s'
  });
  copyButton.addEventListener('click', async e => {
    e.stopPropagation();
    const textToCopy = translationBoxContent.textContent;
    if (!textToCopy) {
      showTooltip('No text to copy!', copyButton);
      return;
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
      showTooltip('Copied!', copyButton);
    } catch (error) {
      console.error('Failed to copy text:', error);
      showTooltip('Failed to copy text.', copyButton);
    }
  });
  document.body.appendChild(copyButton);
};

const createTranslationBoxes = () => {
  // 建立輸入區域
  inputBox = document.createElement('textarea');
  inputBox.id = 'input-box';
  Object.assign(inputBox.style, {
    position: 'fixed',
    top: '20px',
    left: '20px',
    width: '350px',
    height: '60px',
    background: 'rgba(200, 255, 200, 0.5)',
    border: '1px solid #ccc',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: '10001',
    transition: 'opacity 0.3s',
    display: 'none'
  });
  // 建立翻譯結果顯示區域
  translationBox = document.createElement('div');
  translationBox.id = 'translation-box';
  Object.assign(translationBox.style, {
    position: 'fixed',
    top: '90px',
    left: '20px',
    width: '350px',
    height: '100px',
    background: 'rgba(240,255,240,0.5)',
    border: '1px solid #ccc',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: '10001',
    transition: 'opacity 0.3s',
    display: 'none',
    overflowWrap: 'break-word',
    overflowY: 'auto'
  });
  translationBoxContent = document.createElement('div');
  translationBoxContent.id = 'translation-box-content';
  translationBoxContent.style.padding = '10px';
  translationBoxContent.setAttribute('contenteditable', 'true');
  translationBoxContent.style.outline = 'none';
  translationBox.appendChild(translationBoxContent);
  
  // 建立翻譯按鈕
  translateBtn = document.createElement('button');
  translateBtn.id = 'translate-btn';
  Object.assign(translateBtn.style, {
    position: 'fixed',
    top: '60px',
    left: '20px',
    width: '32px',
    height: '32px',
    fontSize: '10px',
    background: `url('${chrome.runtime.getURL('icons/transbtn.png')}') no-repeat center`,
    backgroundSize: 'contain',
    borderRadius: '50%',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    zIndex: '10001',
    display: 'none',
    transition: 'opacity 0.3s'
  });
  translateBtn.addEventListener('click', () => {
    const text = inputBox.value.trim();
    if (text) {
      updateTranslationBox(text);
    } else {
      showTooltip("Please enter text to translate!", translateBtn);
    }
  });
  
  document.body.appendChild(inputBox);
  document.body.appendChild(translationBox);
  document.body.appendChild(translateBtn);
  
  createCopyButton();
  setupOutsideClickListener();
  createTooltip();
};

const toggleTranslationBoxes = () => {
  const btnRect = floatingButton.getBoundingClientRect();
  updateComponentsPosition(btnRect.left, btnRect.top);

  if (inputBox.style.display === 'none' || inputBox.style.opacity === '0') {
    inputBox.style.display = 'block';
    translationBox.style.display = 'block';
    translateBtn.style.display = 'block';
    setTimeout(() => {
      inputBox.style.opacity = '1';
      translationBox.style.opacity = '1';
      translateBtn.style.opacity = '1';
    }, 10);
    toggleCopyButton(true);
  } else {
    inputBox.style.opacity = '0';
    translationBox.style.opacity = '0';
    translateBtn.style.opacity = '0';
    setTimeout(() => {
      inputBox.style.display = 'none';
      translationBox.style.display = 'none';
      translateBtn.style.display = 'none';
    }, 300);
    toggleCopyButton(false);
  }
};

const hideTranslationBoxes = () => {
  if (!inputBox) return;
  inputBox.style.opacity = '0';
  translationBox.style.opacity = '0';
  translateBtn.style.opacity = '0';
  setTimeout(() => {
    inputBox.style.display = 'none';
    translationBox.style.display = 'none';
    translateBtn.style.display = 'none';
  }, 300);
};

const createTooltip = () => {
  tooltip = document.createElement('div');
  tooltip.id = 'copy-tooltip';
  Object.assign(tooltip.style, {
    position: 'fixed',
    top: '100px',
    left: '10px',
    padding: '5px 10px',
    background: 'rgba(0,0,0,0.8)',
    color: '#fff',
    borderRadius: '5px',
    fontSize: '12px',
    zIndex: '10003',
    display: 'none',
    transition: 'opacity 0.3s'
  });
  document.body.appendChild(tooltip);
};

const showTooltip = (msg, targetElement) => {
  tooltip.textContent = msg;
  tooltip.style.display = 'block';
  tooltip.style.opacity = '1';
  
  const tooltipRect = tooltip.getBoundingClientRect();
  let left, top;
  
  if (targetElement) {
    const targetRect = targetElement.getBoundingClientRect();
    left = targetRect.right + 10;
    top = targetRect.top + targetRect.height / 2 - tooltipRect.height / 2;
  } else {
    left = 10;
    top = 10;
  }
  
  if (left + tooltipRect.width > window.innerWidth) {
    if (targetElement) {
      left = targetElement.getBoundingClientRect().left - tooltipRect.width - 10;
    } else {
      left = window.innerWidth - tooltipRect.width - 10;
    }
  }
  
  if (top + tooltipRect.height > window.innerHeight) {
    top = window.innerHeight - tooltipRect.height - 10;
  }
  
  if (top < 0) {
    top = 10;
  }
  
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  
  setTimeout(() => {
    tooltip.style.opacity = '0';
    setTimeout(() => {
      tooltip.style.display = 'none';
    }, 300);
  }, 2000);
};

let isTranslating = false;
const updateTranslationBox = async text => {
  if (isTranslating) return;
  isTranslating = true;
  translationBoxContent.innerHTML = `<img src="${chrome.runtime.getURL('icons/loading.gif')}" style="width:24px;height:24px;">`;
  try {
    const { translations, error } = await requestTranslations('input', [text], inputTargetLanguage);
    translationBoxContent.textContent = error ? `⚠ ${describeError(error)}` : translations[0];
  } catch (err) {
    console.error('Translation failed:', err);
  } finally {
    isTranslating = false;
  }
};

const clearTranslationBox = () => {
  translationBoxContent.textContent = '';
  console.log('Translation box cleared');
};

// 初始化參數
chrome.storage.local.get(['inputTargetLanguage'], data => {
  inputTargetLanguage = data.inputTargetLanguage || 'en';
});

const applySelectionButtonSetting = enabled => {
  enableSelectionButton = enabled;
  if (!enableSelectionButton && selectionTranslationButton) {
    selectionTranslationButton.remove();
    selectionTranslationButton = null;
  }
};

const applyFloatingButtonSetting = async enabled => {
  if (window.top !== window.self) return;
  await updateFloatingButton(enabled);
  if (enabled) {
    if (!inputBox) createTranslationBoxes();
  } else {
    [inputBox, translationBox, translateBtn, document.getElementById('copy-button'), tooltip]
      .forEach(el => el?.remove());
    inputBox = translationBox = translationBoxContent = translateBtn = tooltip = null;
  }
};

chrome.storage.local.get(['enableFloatingButton'], data => {
  applyFloatingButtonSetting(data.enableFloatingButton !== false);
});

// popup 改設定只會寫進 storage（它的 runtime.sendMessage 根本送不到 content script），
// 所以直接監聽 storage 變化，改完馬上生效，不用重新整理頁面
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'local') return;
  const changed = key => key in changes;
  if (changed('isEnabled')) {
    isEnabled = changes.isEnabled.newValue ?? true;
    if (!isEnabled) removeAllTranslations();
  }
  if (changed('myLang')) uiLanguage = changes.myLang.newValue || 'zh';
  if (changed('targetLanguage')) targetLanguage = changes.targetLanguage.newValue || 'zh-TW';
  if (changed('inputTargetLanguage')) inputTargetLanguage = changes.inputTargetLanguage.newValue || 'en';
  if (changed('triggerKey')) triggerKey = changes.triggerKey.newValue || 'ControlRight';
  if (changed('showOriginalTooltip')) showOriginalTooltip = changes.showOriginalTooltip.newValue !== false;
  if (changed('enableSelectionButton')) applySelectionButtonSetting(changes.enableSelectionButton.newValue !== false);
  if (changed('enableFloatingButton')) applyFloatingButtonSetting(changes.enableFloatingButton.newValue !== false);
});

// 告訴 background 這是剛載入的新頁面，右鍵選單的整頁翻譯狀態要重設
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }, () => void chrome.runtime.lastError);

// Auto-start page translation for whitelisted sites
chrome.storage.local.get(["siteTranslationList"], async data => {
  const list = data.siteTranslationList || [];
  if (!list.includes(window.location.origin)) return;
  // 同步通知 background，右鍵選單才會顯示 Restore Page
  chrome.runtime.sendMessage({ type: 'TRANSLATE_PAGE' }, () => void chrome.runtime.lastError);
  await translatePage();
});

// 額外右鍵選單用的區塊
// 在 content.js 一開始就讀取設定值
let customContextMenuMode = "2"; // 預設模式
chrome.storage.local.get(['customContextMenuMode'], function(result) {
  if(result.customContextMenuMode) {
    customContextMenuMode = result.customContextMenuMode;
  }
});

// 如果設定在運行期間有變動，也更新全域變數
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.customContextMenuMode) {
    customContextMenuMode = changes.customContextMenuMode.newValue;
    console.log('更新 customContextMenuMode 為：', customContextMenuMode);
  }
});

(function() {
  let currentTabId = null;
  chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, (response) => {
    currentTabId = response.tabId;
  });

  let customMenu = null;

  function showCustomMenu(e) {
    if (customMenu) {
      customMenu.remove();
      customMenu = null;
    }
    
    customMenu = document.createElement('div');
    customMenu.id = 'custom-context-menu';
    Object.assign(customMenu.style, {
      position: 'absolute',
      background: 'rgba(211, 211, 211, 0.8)', // 淺灰色半透明
      borderRadius: '8px',
      padding: '5px',
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      zIndex: 10000,
      top: e.pageY + 'px',
      left: (e.pageX - 50) + 'px'
    });

    // 按鈕配置（保持原本功能）
    const buttons = [
      { 
        id: 'clearTriggled', 
        icon: chrome.runtime.getURL('icons/letter-c.png'), 
        title: 'Clear Triggled',
        action: () => { removeAllTranslations(); },
        messageType: 'CLEAR_ALL_TRANSLATIONS'
      },
      { 
        id: 'restorePage', 
        icon: chrome.runtime.getURL('icons/letter-r.png'), 
        title: 'Restore Page',
        action: () => { restorePage(); },
        messageType: 'RESTORE_PAGE'
      },
      { 
        id: 'selectTranslate', 
        icon: chrome.runtime.getURL('icons/letter-s.png'), 
        title: 'Select Translate',
        action: () => { 
          const targetElem = document.elementFromPoint(e.clientX, e.clientY);
          if (targetElem) { handleTranslation(targetElem); }
        },
        messageType: 'TRANSLATE_SELECTION'
      },
      {
        id: 'pageTranslate',
        icon: chrome.runtime.getURL('icons/letter-p.png'),
        title: 'Page Translate',
        action: () => {
          translatePage();
        },
        messageType: 'TRANSLATE_PAGE'
      }
    ];

    // 為每個按鈕建立圖示，加入反白效果
    buttons.forEach(btn => {
      const button = document.createElement('img');
      button.id = btn.id;
      button.src = btn.icon;
      button.title = btn.title;
      button.style.width = '30px';
      button.style.height = '30px';
      button.style.cursor = 'pointer';
      button.style.transition = 'filter 0.2s ease';

      button.addEventListener('mouseenter', () => {
        button.style.filter = 'invert(1)';
      });
      button.addEventListener('mouseleave', () => {
        button.style.filter = 'invert(0)';
      });

      button.addEventListener('click', (ev) => {
        ev.stopPropagation();
        btn.action();
        chrome.runtime.sendMessage({ type: btn.messageType, tabId: currentTabId });
        hideCustomMenu();
      });
      
      customMenu.appendChild(button);
    });

    document.body.appendChild(customMenu);
  }

  function hideCustomMenu() {
    if (customMenu) {
      customMenu.remove();
      customMenu = null;
    }
  }

  // 這裡直接使用全域變數 customContextMenuMode，同步檢查
  document.addEventListener('contextmenu', (e) => {
    if (customContextMenuMode === "3") {
      // 模式3：禁用自訂選單
      return;
    }
    if (customContextMenuMode === "1") {
      // 模式1：禁用預設右鍵選單
      e.preventDefault();
    }
    // 模式2：不阻止預設右鍵選單

    showCustomMenu(e);
    setTimeout(() => {
      document.addEventListener('click', hideCustomMenu, { once: true });
    }, 0);
  });
})();
