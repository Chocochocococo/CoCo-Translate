// content.js
let isEnabled = true,
    enableSelectionButton = true,
    targetLanguage = 'zh-TW',
    isPageTranslationMode = false,
    isRestoring = false,
    showOriginalTooltip = true,
    pageDisplayMode = 'replace',   // 整頁翻譯：replace 取代原文、bilingual 雙語對照
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

chrome.storage.local.get(['isEnabled', 'targetLanguage', 'triggerKey', 'enableSelectionButton', 'showOriginalTooltip', 'pageDisplayMode'], data => {
  pageDisplayMode = data.pageDisplayMode === 'bilingual' ? 'bilingual' : 'replace';
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

// ---------------- 網頁裡的 UI 外觀：跟 popup 同一個設定（自動／淺色／深色） ----------------
// 顏色做成 --coco-* 變數掛在我們自己的元素上，inline style 用 var(--coco-…)；
// 不碰網頁的 <html>，也不用塞 <style>（有些網站的 CSP 會擋）
const PageTheme = (() => {
  const PALETTES = {
    light: {
      '--coco-surface': '#ffffff',
      '--coco-surface-2': '#eef4e8',
      '--coco-border': '#e3ead9',
      '--coco-text': '#2e3a2a',
      '--coco-muted': '#7b8a73',
      '--coco-accent': '#5cb87a',
      '--coco-accent-ink': '#ffffff',
      '--coco-shadow': '0 6px 20px rgba(60, 80, 50, 0.22)',
      '--coco-input-bg': 'rgba(200, 255, 200, 0.5)',
      '--coco-output-bg': 'rgba(240, 255, 240, 0.5)',
      '--coco-scheme': 'light'
    },
    // 他媽的，晚上看小說不刺眼
    dark: {
      '--coco-surface': '#212724',
      '--coco-surface-2': '#2a312d',
      '--coco-border': '#3a443e',
      '--coco-text': '#e6ece8',
      '--coco-muted': '#95a39b',
      '--coco-accent': '#5ccb93',
      '--coco-accent-ink': '#0f2219',
      '--coco-shadow': '0 6px 20px rgba(0, 0, 0, 0.5)',
      '--coco-input-bg': 'rgba(33, 52, 42, 0.92)',
      '--coco-output-bg': 'rgba(28, 36, 32, 0.92)',
      '--coco-scheme': 'dark'
    }
  };
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const elements = new Set();
  let mode = 'auto';

  const resolved = () => (mode === 'dark' || (mode === 'auto' && media?.matches) ? 'dark' : 'light');

  const paint = element => {
    const theme = resolved();
    Object.entries(PALETTES[theme]).forEach(([name, value]) => element.style.setProperty(name, value));
    element.dataset.cocoTheme = theme;
  };

  const refresh = () => elements.forEach(element => {
    // 單字卡這種關掉就丟的元素，不在頁面上了就別再管它
    if (element.isConnected) paint(element);
    else elements.delete(element);
  });

  const setMode = value => {
    mode = ['auto', 'light', 'dark'].includes(value) ? value : 'auto';
    refresh();
  };

  chrome.storage.local.get(['uiTheme'], data => setMode(data.uiTheme));
  media?.addEventListener?.('change', refresh);

  // 元素建立時登記一次，之後切換外觀會自動重畫
  const register = element => {
    elements.add(element);
    paint(element);
    return element;
  };

  return { register, setMode, resolved };
})();

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
const requestTranslations = (role, texts, targetLang = targetLanguage, format = 'text', { quiet = false } = {}) => new Promise(resolve => {
  if (!texts.length) return resolve({ translations: [], error: null });
  // quiet：字幕這種連續不斷的翻譯，失敗就等下一句再試，不跳提示
  const report = error => {
    if (!quiet) showTranslationError(error);
  };
  const fail = message => {
    const error = { code: 'network', message, provider: '' };
    report(error);
    resolve({ translations: texts, error });
  };
  try {
    chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', role, texts, targetLang, format }, response => {
      if (chrome.runtime.lastError || !response) {
        console.error('Fuck, 翻譯請求失敗:', chrome.runtime.lastError);
        return fail(chrome.runtime.lastError?.message || 'No response from background');
      }
      if (response.error) report(response.error);
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
async function translateJobs(role, jobs, targetLang = targetLanguage, format = 'text') {
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
      const { translations, error } = await requestTranslations(role, batch.map(job => job.text), targetLang, format);
      batch.forEach((job, i) => {
        // 翻譯失敗、原文奉還的就別套了（錯誤提示已經跳出來）
        if (error && translations[i] === job.text) return;
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
  '.immersive-translation-container', '.coco-bilingual', '#custom-context-menu', '#input-box', '#translation-box',
  '#coco-selection-toolbar', '#coco-word-card', '#coco-yt-subtitle', '.ytp-caption-window-container',
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

// ---------------- 段落翻譯：整段連同行內樣式一起送 ----------------
// 一段文字（段落、標題、列表項、<br> 隔開的一行……）裡的行內元素，會換成帶 id 的標籤一起送出：
//   He said <b id="g0">hello</b> to <i id="g1">her</i>.
// 翻譯服務照目標語言的語序擺好標籤後，再把譯文套回「原本的」元素。
// 只重複使用原節點、只在同一層裡調整順序，不刪除也不跨層移動，React 之類的網站才不會壞掉。
// 標籤對不回去就退回舊的「一個樣式一個片段」。

// 行內元素：跟著整段一起翻
const INLINE_TAGS = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'button', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font',
  'i', 'ins', 'kbd', 'label', 'mark', 'nobr', 'q', 'rb', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u', 'var'
]);
// 送給翻譯服務時保留原本的標籤名稱（給翻譯服務一點提示），其他一律用 span
// code / kbd / samp 不能照原名送：Google 會把裡面的字當程式碼不翻
const MARKUP_TAG_NAMES = new Set([
  'a', 'abbr', 'b', 'cite', 'del', 'em', 'i', 'ins', 'mark', 'q', 's', 'small', 'span',
  'strong', 'sub', 'sup', 'u'
]);
// 段落裡原封不動的東西（圖片、表單元件、程式……），送出時變成 <img id="xN">
const ATOMIC_TAGS = new Set([
  'img', 'input', 'svg', 'video', 'audio', 'canvas', 'iframe', 'object', 'embed', 'math', 'picture', 'wbr',
  'script', 'style', 'noscript', 'template', 'textarea'
]);
// 行內元素裡包了這些，就不能當成行內元素處理
const BLOCK_SELECTOR = 'address, article, aside, blockquote, details, dialog, dd, div, dl, dt, fieldset, figcaption, ' +
  'figure, footer, form, h1, h2, h3, h4, h5, h6, header, hgroup, hr, li, main, nav, ol, p, pre, section, table, ul, select, br';
// 太長的一段就不整段送了（通常是沒有分段的怪網頁），直接用舊方式
const MAX_UNIT_CHARS = 3000;
const BILINGUAL_MAX_UNIT_CHARS = 8000;

let translatedUnits = [];   // 整頁翻譯時套用過的段落，還原用

const isPreformatted = element => {
  if (element.closest('pre')) return true;
  if (!element.isConnected) return false;
  return /^pre/.test(getComputedStyle(element).whiteSpace || '');
};

function buildUnit(parent, nodes, { maxChars = MAX_UNIT_CHARS } = {}) {
  const preserveWhitespace = isPreformatted(parent);
  const elements = new Map();       // id → { el, atomic }
  const expectedParents = {};       // id → 父元素 id（最外層為 null）
  const textNodes = [];

  const serialize = (node, parentId) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textNodes.push(node);
      const text = preserveWhitespace ? node.textContent : node.textContent.replace(/\s+/g, ' ');
      return Markup.escapeText(text);
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const atomic = ATOMIC_TAGS.has(node.localName) || node.matches(SKIP_SELECTOR);
    const id = `${atomic ? 'x' : 'g'}${elements.size}`;
    elements.set(id, { el: node, atomic });
    expectedParents[id] = parentId;
    if (atomic) return `<img id="${id}">`;
    const tag = MARKUP_TAG_NAMES.has(node.localName) ? node.localName : 'span';
    const inner = [...node.childNodes].map(child => serialize(child, id)).join('');
    return `<${tag} id="${id}">${inner}</${tag}>`;
  };

  const html = nodes.map(node => serialize(node, null)).join('');
  const core = html.trim();
  if (!core || core.length > maxChars) return null;
  return {
    parent,
    nodes,
    elements,
    expectedParents,
    textNodes,
    meaningfulTextNodes: textNodes.filter(n => /\p{L}/u.test(n.textContent)),
    originalTexts: new Map(textNodes.map(n => [n, n.textContent])),
    html: core,
    lead: html.match(/^\s*/)[0],
    trail: html.slice(core.length + html.match(/^\s*/)[0].length)
  };
}

/**
 * 找出 root 底下所有要翻的段落
 * @returns {{ units: Object[], fragmentNodes: Text[] }} fragmentNodes：只能用舊方式逐片段翻的文字節點
 */
function collectUnits(root, { fromMutation = false, bilingual = false } = {}) {
  const units = [];
  const fragmentNodes = [];
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return { units, fragmentNodes };
  if (root.matches(SKIP_SELECTOR) || ATOMIC_TAGS.has(root.localName)) return { units, fragmentNodes };

  const handleRun = (parent, run) => {
    // 頭尾的空白文字節點不算進這一段
    while (run.length && run[0].nodeType === Node.TEXT_NODE && !run[0].textContent.trim()) run.shift();
    while (run.length && run[run.length - 1].nodeType === Node.TEXT_NODE && !run[run.length - 1].textContent.trim()) run.pop();
    if (!run.length) return;

    const textNodes = [];
    for (const node of run) {
      if (node.nodeType === Node.TEXT_NODE) {
        textNodes.push(node);
      } else if (!ATOMIC_TAGS.has(node.localName)) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
        while (walker.nextNode()) {
          if (!SKIP_TAGS.has(walker.currentNode.parentElement?.tagName)) textNodes.push(walker.currentNode);
        }
      }
    }
    const meaningful = textNodes.filter(n => /\p{L}/u.test(n.textContent));
    if (!meaningful.length || shouldSkipTextNode(meaningful[0], fromMutation)) return;

    // 已經翻過的段落就跳過；翻過之後網頁又改了其中幾個字，就只用舊方式翻改掉的部分
    const fresh = meaningful.filter(n => translatedTextMap.get(n) !== n.textContent);
    if (!fresh.length) return;
    if (bilingual) {
      // 雙語對照不動原文，沒有「逐片段換掉原文」這條退路：整段重翻、重新插一次譯文
      const unit = buildUnit(parent, run, { maxChars: BILINGUAL_MAX_UNIT_CHARS });
      if (unit) units.push(Object.assign(unit, { bilingual: true }));
      return;
    }
    if (fresh.length !== meaningful.length) {
      fragmentNodes.push(...fresh);
      return;
    }
    const unit = buildUnit(parent, run);
    if (unit) units.push(unit);
    else fragmentNodes.push(...fresh);
  };

  const walk = container => {
    let run = [];
    const flush = () => {
      handleRun(container, run);
      run = [];
    };
    for (const child of [...container.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        run.push(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const name = child.localName;
      if (child.matches(SKIP_SELECTOR) || SKIP_TAGS.has(child.tagName) || name === 'br') {
        flush();
        continue;
      }
      if (ATOMIC_TAGS.has(name) || (INLINE_TAGS.has(name) && !child.querySelector(BLOCK_SELECTOR))) {
        run.push(child);
        continue;
      }
      flush();
      walk(child);
    }
    flush();
  };

  walk(root);
  return { units, fragmentNodes };
}

/**
 * 把翻好的標記套回原本的節點
 * @param {boolean} live true：正在整頁翻譯的網頁（要檢查有沒有被改掉、要記錄還原資訊）
 * @returns {'applied'|'invalid'|'stale'} invalid：標籤對不回去，要退回舊方式
 */
function applyUnit(unit, translated, { live }) {
  const tree = Markup.parse(translated);
  if (!Markup.matchesStructure(tree, unit.expectedParents)) return 'invalid';

  if (live) {
    // 翻譯途中被還原、或網頁自己改掉了，就別蓋上去
    if (!isPageTranslationMode) return 'stale';
    if (unit.textNodes.some(n => n.textContent !== unit.originalTexts.get(n))) return 'stale';
    if (unit.nodes.some(n => n.parentNode !== unit.parent)) return 'stale';
  }

  // 補回段落前後原本的空白
  const rootItems = tree.children;
  if (unit.lead) {
    if (rootItems[0]?.type === 'text') rootItems[0].text = unit.lead + rootItems[0].text;
    else rootItems.unshift({ type: 'text', text: unit.lead });
  }
  if (unit.trail) {
    const last = rootItems[rootItems.length - 1];
    if (last?.type === 'text') last.text += unit.trail;
    else rootItems.push({ type: 'text', text: unit.trail });
  }

  const snapshot = {
    parent: unit.parent,
    rootNodes: [...unit.nodes],
    anchor: unit.nodes[unit.nodes.length - 1].nextSibling,
    containers: [],
    texts: new Map(unit.originalTexts),
    created: []
  };

  // 依譯文順序擺放：文字優先重複使用原本的文字節點，不夠才新增；用不到的清空但不刪除
  const place = (container, items, pool, anchor) => {
    const sequence = [];
    let used = 0;
    for (const item of items) {
      if (item.type === 'text') {
        if (!item.text) continue;
        let node = pool[used++];
        if (!node) {
          node = document.createTextNode('');
          snapshot.created.push(node);
        }
        node.textContent = item.text;
        sequence.push(node);
        continue;
      }
      const entry = unit.elements.get(item.id);
      if (!entry.atomic) {
        const children = [...entry.el.childNodes];
        snapshot.containers.push({ el: entry.el, children });
        place(entry.el, item.children, children.filter(n => n.nodeType === Node.TEXT_NODE), null);
      }
      sequence.push(entry.el);
    }
    pool.slice(used).forEach(node => { node.textContent = ''; });
    sequence.forEach(node => container.insertBefore(node, anchor));
  };
  place(unit.parent, rootItems, unit.nodes.filter(n => n.nodeType === Node.TEXT_NODE), snapshot.anchor);

  for (const node of [...unit.textNodes, ...snapshot.created]) {
    translatedTextMap.set(node, node.textContent);
    originalTextMap.set(node, snapshot.texts.get(node) ?? '');
  }
  if (live) translatedUnits.push(snapshot);
  return 'applied';
}

// ---------------- 雙語對照：原文不動，譯文另外插在這一段後面 ----------------
const bilingualWrappers = new WeakMap();   // 段落最後一個節點 → 插在它後面的譯文

function applyUnitBilingual(unit, translated) {
  if (!isPageTranslationMode) return 'stale';
  if (unit.textNodes.some(n => n.textContent !== unit.originalTexts.get(n))) return 'stale';
  const last = unit.nodes[unit.nodes.length - 1];
  if (last.parentNode !== unit.parent) return 'stale';

  const wrapper = document.createElement('font');
  wrapper.className = 'coco-bilingual';
  Object.assign(wrapper.style, { display: 'block', marginTop: '0.25em' });

  const tree = Markup.parse(translated);
  if (Markup.matchesStructure(tree, unit.expectedParents)) {
    // 行內樣式用原元素的淺層複製（連結、粗體照樣有），圖片、表單元件不重複放
    const render = (items, target) => items.forEach(item => {
      if (item.type === 'text') {
        target.appendChild(document.createTextNode(item.text));
        return;
      }
      const entry = unit.elements.get(item.id);
      if (entry.atomic) return;
      const clone = entry.el.cloneNode(false);
      clone.removeAttribute('id');
      render(item.children, clone);
      target.appendChild(clone);
    });
    render(tree.children, wrapper);
  } else {
    // 標籤對不回去就只放純文字
    wrapper.textContent = Markup.stripTags(translated);
  }
  if (!wrapper.textContent.trim()) return 'stale';

  bilingualWrappers.get(last)?.remove();
  bilingualWrappers.set(last, wrapper);
  unit.parent.insertBefore(wrapper, last.nextSibling);
  // 原文沒變，但要記成「翻過了」，網頁變動時才不會重翻
  unit.textNodes.forEach(n => translatedTextMap.set(n, n.textContent));
  return 'applied';
}

// 還原整頁翻譯套用過的段落（後套用的先還原）
function restoreUnits() {
  for (const snapshot of translatedUnits.reverse()) {
    snapshot.texts.forEach((text, node) => { node.textContent = text; });
    snapshot.created.forEach(node => node.remove());
    for (const { el, children } of snapshot.containers) {
      children.forEach(child => {
        if (child.parentNode === el) el.appendChild(child);
      });
    }
    const { parent, anchor } = snapshot;
    if (!anchor || anchor.parentNode === parent) {
      snapshot.rootNodes.forEach(node => {
        if (node.parentNode === parent) parent.insertBefore(node, anchor);
      });
    }
  }
  translatedUnits = [];
  document.querySelectorAll('.coco-bilingual').forEach(wrapper => wrapper.remove());
}

/**
 * 馬上翻：先整段翻，對不回去的段落再用舊方式逐片段翻
 */
async function translateUnitsNow(units, fragmentNodes, { fromMutation = false } = {}) {
  const failed = [];
  await translateJobs('page', units.map(unit => ({
    text: unit.html,
    apply: translated => {
      if (unit.bilingual) applyUnitBilingual(unit, translated);
      else if (applyUnit(unit, translated, { live: true }) === 'invalid') failed.push(unit);
    }
  })), targetLanguage, 'html');

  if (failed.length) console.warn(`CoCo：${failed.length} 段的標籤對不回去，改用逐片段翻譯`);
  const fallbackNodes = [...fragmentNodes, ...failed.flatMap(unit => unit.meaningfulTextNodes)];
  const jobs = fallbackNodes.flatMap(node => collectPageTextJobs(node, { fromMutation }));
  await translateJobs('page', jobs, targetLanguage);
}

// ---------------- 只翻畫面附近的段落 ----------------
// 整頁翻譯時段落先登記起來，捲到畫面上下各一個螢幕的範圍內才送出，長頁面可以省很多額度；
// 隱藏起來的內容（收合的區塊、分頁）等到顯示出來才翻
const VISIBLE_ROOT_MARGIN = '100% 0px';
const VISIBLE_FLUSH_DELAY = 150;          // 捲動時等一下，把同時進入畫面的段落湊成一批
let visibilityObserver = null;
let unitsWaitingForView = new Map();      // 段落所在的元素 → 等著翻的段落
let visibleUnits = [];
let visibleFlushTimer = null;

const flushVisibleUnits = () => {
  visibleFlushTimer = null;
  const batch = visibleUnits;
  visibleUnits = [];
  if (!batch.length || !isPageTranslationMode) return;
  const byMutation = batch.filter(item => item.fromMutation).map(item => item.unit);
  const initial = batch.filter(item => !item.fromMutation).map(item => item.unit);
  if (initial.length) translateUnitsNow(initial, []);
  if (byMutation.length) translateUnitsNow(byMutation, [], { fromMutation: true });
};

const onVisibilityChange = entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const waiting = unitsWaitingForView.get(entry.target);
    unitsWaitingForView.delete(entry.target);
    visibilityObserver.unobserve(entry.target);
    if (waiting) visibleUnits.push(...waiting);
  }
  if (visibleUnits.length && !visibleFlushTimer) {
    visibleFlushTimer = setTimeout(flushVisibleUnits, VISIBLE_FLUSH_DELAY);
  }
};

const stopVisibilityObserver = () => {
  visibilityObserver?.disconnect();
  visibilityObserver = null;
  unitsWaitingForView = new Map();
  visibleUnits = [];
  clearTimeout(visibleFlushTimer);
  visibleFlushTimer = null;
};

/**
 * 整頁翻譯：段落等進入畫面附近再翻；逐片段翻的部分馬上翻
 */
async function translatePageUnits(units, fragmentNodes, { fromMutation = false } = {}) {
  if (typeof IntersectionObserver === 'undefined') {
    await translateUnitsNow(units, fragmentNodes, { fromMutation });
    return;
  }
  visibilityObserver ??= new IntersectionObserver(onVisibilityChange, { rootMargin: VISIBLE_ROOT_MARGIN });
  for (const unit of units) {
    const target = unit.parent;
    if (!unitsWaitingForView.has(target)) {
      unitsWaitingForView.set(target, []);
      visibilityObserver.observe(target);
    }
    unitsWaitingForView.get(target).push({ unit, fromMutation });
  }
  if (fragmentNodes.length) await translateUnitsNow([], fragmentNodes, { fromMutation });
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
  const role = isPageTranslationMode ? 'page' : 'trigger';
  const { units, fragmentNodes } = collectUnits(container);
  let translatedAny = false;
  let hadError = false;

  // 先整段翻
  const fallbackNodes = [...fragmentNodes];
  if (units.length) {
    const { translations, error } = await requestTranslations(role, units.map(unit => unit.html), targetLanguage, 'html');
    hadError = !!error;
    units.forEach((unit, i) => {
      if (error && translations[i] === unit.html) return;
      if (applyUnit(unit, translations[i], { live: false }) === 'applied') translatedAny = true;
      else fallbackNodes.push(...unit.meaningfulTextNodes);
    });
  }

  // 標籤對不回去的，退回逐片段翻
  if (fallbackNodes.length) {
    const parts = fallbackNodes.map(node => splitWhitespace(node.textContent));
    const { translations, error } = await requestTranslations(role, parts.map(part => part.core), targetLanguage);
    hadError ||= !!error;
    fallbackNodes.forEach((node, i) => {
      if (error && translations[i] === parts[i].core) return;
      node.textContent = parts[i].lead + translations[i] + parts[i].trail;
      translatedAny = true;
    });
  }

  // 全部失敗就別插一份跟原文一模一樣的東西
  if (hadError && !translatedAny) return null;
  return container.innerHTML;
};

const translatePage = async () => {
  isRestoring = false;
  isPageTranslationMode = true;
  hideTranslationButton();
  startAutoTranslationObserver();
  const { units, fragmentNodes } = collectUnits(document.body, { bilingual: pageDisplayMode === 'bilingual' });
  await translatePageUnits(units, fragmentNodes);
  await translateJobs('page', [...collectTextareaJobs(), ...collectAttributeJobs()], targetLanguage);
};

const restorePage = () => {
  disableAutoTranslation();
  removeAllTranslations();
  restoreUnits();
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
    const connected = [...new Set(pendingNodes)].filter(node => node.isConnected);
    pendingNodes = [];
    // 父節點也在清單裡的就不用重複收集
    const roots = connected.filter(node => !connected.some(other => other !== node && other.contains(node)));
    const units = [];
    const fragmentNodes = [];
    for (const node of roots) {
      if (node.nodeType === Node.TEXT_NODE) {
        fragmentNodes.push(node);
        continue;
      }
      const collected = collectUnits(node, { fromMutation: true, bilingual: pageDisplayMode === 'bilingual' });
      units.push(...collected.units);
      fragmentNodes.push(...collected.fragmentNodes);
    }
    await translatePageUnits(units, fragmentNodes, { fromMutation: true });
  }, 300);
  });
  pageTranslationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
};

const stopAutoTranslationObserver = () => {
  stopVisibilityObserver();
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
  // 雙語對照時原文本來就看得到，不用提示
  if (isPageTranslationMode && showOriginalTooltip && pageDisplayMode !== 'bilingual') {
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


// Selection toolbar：翻譯段落、查單字、朗讀
let lastSelection = null;   // 放開滑鼠時記下選取內容（點工具列時選取範圍可能已經變了）
let wordCard = null;

const TOOLBAR_TEXT = {
  zh: { translate: '翻譯這一段', lookup: '查字典', speak: '朗讀', save: '加入生字本', saved: '已加入 ✓', close: '關閉', loading: '查詢中…', context: '例句' },
  en: { translate: 'Translate paragraph', lookup: 'Look up', speak: 'Read aloud', save: 'Add to vocabulary', saved: 'Added ✓', close: 'Close', loading: 'Looking up…', context: 'Context' }
};
const toolbarText = key => (TOOLBAR_TEXT[uiLanguage] || TOOLBAR_TEXT.en)[key];

// 依文字判斷朗讀要用的語言
const guessSpeechLang = text => {
  if (/[぀-ヿ]/.test(text)) return 'ja-JP';
  if (/[가-힯]/.test(text)) return 'ko-KR';
  if (/[一-鿿]/.test(text)) return 'zh-TW';
  if (/[Ѐ-ӿ]/.test(text)) return 'ru-RU';
  if (/[฀-๿]/.test(text)) return 'th-TH';
  return 'en-US';
};

// 用瀏覽器內建的語音合成朗讀（免費、不用 API）
const speak = text => {
  if (!text || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
  utterance.lang = guessSpeechLang(text);
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(v => v.lang === utterance.lang) ||
    voices.find(v => v.lang.startsWith(utterance.lang.slice(0, 2))) || null;
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
};

// 從整段文字裡挑出包含這個字的那一句當例句
const extractSentence = (paragraph, word) => {
  const text = paragraph.replace(/\s+/g, ' ').trim();
  const sentences = text.split(/(?<=[.!?。！？])\s*/);
  return (sentences.find(sentence => sentence.includes(word)) || text).slice(0, 300);
};

const getSelectionInfo = () => {
  const selection = window.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const range = selection.getRangeAt(0);
  const element = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentElement
    : range.commonAncestorContainer;
  if (!element || element.closest(`${SKIP_SELECTOR}, #coco-selection-toolbar, #coco-word-card`)) return null;
  const block = getClosestContentContainer(element) || element;
  return {
    text,
    element,
    rect: range.getBoundingClientRect(),
    context: extractSentence(block.innerText || block.textContent || '', text)
  };
};

const createTranslationButton = () => {
  if (selectionTranslationButton) return;
  selectionTranslationButton = document.createElement('div');
  selectionTranslationButton.id = 'coco-selection-toolbar';
  PageTheme.register(selectionTranslationButton);
  Object.assign(selectionTranslationButton.style, {
    position: 'absolute',
    zIndex: '10000',
    display: 'none',
    gap: '2px',
    padding: '3px',
    background: 'var(--coco-surface)',
    border: '1px solid var(--coco-border)',
    borderRadius: '999px',
    boxShadow: 'var(--coco-shadow)'
  });

  const makeButton = (content, titleKey, onClick) => {
    const button = document.createElement('button');
    button.title = toolbarText(titleKey);
    button.dataset.action = titleKey;
    if (typeof content === 'string') button.textContent = content;
    else button.appendChild(content);
    Object.assign(button.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '30px',
      height: '30px',
      border: 'none',
      borderRadius: '50%',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: '17px',
      padding: '0',
      transition: 'background 0.15s'
    });
    button.addEventListener('mouseenter', () => { button.style.background = 'var(--coco-surface-2)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; });
    // 按下去時別讓按鈕搶走網頁上的選取
    button.addEventListener('mousedown', e => e.preventDefault());
    button.addEventListener('click', e => {
      e.stopPropagation();
      button.title = toolbarText(titleKey);
      onClick();
    });
    selectionTranslationButton.appendChild(button);
    return button;
  };

  const icon = document.createElement('img');
  icon.src = chrome.runtime.getURL('icons/translation.png');
  Object.assign(icon.style, { width: '24px', height: '24px' });
  selectionTranslationButton.translateButton = makeButton(icon, 'translate', () => {
    const element = lastSelection?.element;
    hideTranslationButton();
    if (element && !isPageTranslationMode) handleTranslation(element);
  });
  makeButton('📖', 'lookup', () => {
    if (lastSelection) showWordCard(lastSelection);
  });
  makeButton('🔊', 'speak', () => speak(lastSelection?.text));

  document.body.appendChild(selectionTranslationButton);
};

const showTranslationButton = e => {
  if (e?.target?.closest?.('#coco-selection-toolbar, #coco-word-card')) return;
  if (!isEnabled || !enableSelectionButton) return;
  const info = getSelectionInfo();
  if (!info) return;
  lastSelection = info;
  createTranslationButton();
  // 整頁翻譯時段落已經翻好了，只留查字典和朗讀
  selectionTranslationButton.translateButton.style.display = isPageTranslationMode ? 'none' : 'inline-flex';
  selectionTranslationButton.style.left = `${cursorPosition.x + 20 + window.scrollX}px`;
  selectionTranslationButton.style.top = `${cursorPosition.y - 40 + window.scrollY}px`;
  selectionTranslationButton.style.display = 'flex';
};

const hideTranslationButton = () => {
  if (selectionTranslationButton) selectionTranslationButton.style.display = 'none';
};

// ---------------- 單字卡 ----------------
const hideWordCard = () => {
  wordCard?.remove();
  wordCard = null;
};

const addToVocabulary = entry => new Promise(resolve => {
  chrome.storage.local.get(['vocabulary'], data => {
    const key = entry.word.toLowerCase();
    // 同一個字只留一筆，新的例句蓋掉舊的
    const vocabulary = (data.vocabulary || []).filter(item => item.word.toLowerCase() !== key);
    vocabulary.unshift(entry);
    chrome.storage.local.set({ vocabulary }, resolve);
  });
});

function showWordCard(info) {
  hideTranslationButton();
  hideWordCard();
  const word = info.text.slice(0, 200);

  wordCard = document.createElement('div');
  wordCard.id = 'coco-word-card';
  PageTheme.register(wordCard);
  const width = 320;
  const left = Math.min(Math.max(8, info.rect.left), window.innerWidth - width - 8);
  const below = info.rect.bottom + 8;
  Object.assign(wordCard.style, {
    position: 'fixed',
    left: `${left}px`,
    top: `${below + 220 > window.innerHeight ? Math.max(8, info.rect.top - 228) : below}px`,
    width: `${width}px`,
    maxHeight: '320px',
    overflowY: 'auto',
    padding: '14px 16px',
    background: 'var(--coco-surface)',
    color: 'var(--coco-text)',
    colorScheme: 'var(--coco-scheme)',
    font: '14px/1.5 system-ui, "Microsoft JhengHei", "PingFang TC", sans-serif',
    textAlign: 'left',
    border: '1px solid var(--coco-border)',
    borderRadius: '16px',
    boxShadow: 'var(--coco-shadow)',
    boxSizing: 'border-box',
    zIndex: '10005'
  });

  const el = (tag, style = {}, text = '') => {
    const node = document.createElement(tag);
    Object.assign(node.style, style);
    if (text) node.textContent = text;
    return node;
  };

  const header = el('div', { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' });
  const title = el('strong', { fontSize: '17px', color: 'var(--coco-text)' }, word);
  const phonetic = el('span', { color: 'var(--coco-muted)' });
  phonetic.className = 'coco-phonetic';
  const speakButton = el('button', { border: 'none', background: 'none', cursor: 'pointer', fontSize: '16px', padding: '0' }, '🔊');
  speakButton.title = toolbarText('speak');
  speakButton.addEventListener('click', () => speak(word));
  header.append(title, phonetic, speakButton);

  const translation = el('div', { marginTop: '6px', fontSize: '15px' }, toolbarText('loading'));
  translation.className = 'coco-word-translation';
  const definitions = el('ul', { margin: '6px 0 0', paddingLeft: '18px', color: 'var(--coco-text)', opacity: '0.85', fontSize: '13px' });
  const context = el('div', { marginTop: '8px', color: 'var(--coco-muted)', fontSize: '12px', fontStyle: 'italic' });
  if (info.context && info.context !== word) context.textContent = `${toolbarText('context')}：${info.context}`;

  const footer = el('div', { display: 'flex', gap: '8px', marginTop: '10px' });
  const buttonStyle = { padding: '5px 14px', border: 'none', borderRadius: '999px', cursor: 'pointer', font: '600 13px system-ui, sans-serif' };
  const saveButton = el('button', { ...buttonStyle, background: 'var(--coco-accent)', color: 'var(--coco-accent-ink)' }, toolbarText('save'));
  saveButton.className = 'coco-save-word';
  // 還沒查到譯文、或已經收藏了 → 按鈕變淡
  const setSaveEnabled = enabled => {
    saveButton.disabled = !enabled;
    saveButton.style.opacity = enabled ? '1' : '0.5';
    saveButton.style.cursor = enabled ? 'pointer' : 'default';
  };
  setSaveEnabled(false);
  const closeButton = el('button', { ...buttonStyle, background: 'var(--coco-surface-2)', color: 'var(--coco-text)' }, toolbarText('close'));
  closeButton.addEventListener('click', hideWordCard);
  footer.append(saveButton, closeButton);

  wordCard.append(header, translation, definitions, context, footer);
  document.body.appendChild(wordCard);

  const card = wordCard;
  let result = { translation: '', phonetic: '' };
  chrome.runtime.sendMessage({ type: 'LOOKUP_WORD', word, targetLang: targetLanguage }, response => {
    if (card !== wordCard) return;   // 已經關掉或換了一張
    if (chrome.runtime.lastError || !response) {
      translation.textContent = describeError({ code: 'network', provider: '' });
      return;
    }
    if (response.error) {
      translation.textContent = `⚠ ${describeError(response.error)}`;
    } else {
      translation.textContent = response.translation;
      result.translation = response.translation;
      setSaveEnabled(true);
    }
    const dictionary = response.dictionary;
    if (dictionary) {
      phonetic.textContent = dictionary.phonetic || '';
      result.phonetic = dictionary.phonetic || '';
      dictionary.meanings.forEach(meaning => {
        const item = el('li', {}, `${meaning.partOfSpeech ? `(${meaning.partOfSpeech}) ` : ''}${meaning.definition}`);
        definitions.appendChild(item);
      });
    }
  });

  saveButton.addEventListener('click', async () => {
    await addToVocabulary({
      word,
      translation: result.translation,
      phonetic: result.phonetic,
      context: info.context && info.context !== word ? info.context : '',
      url: location.href,
      title: document.title,
      addedAt: Date.now()
    });
    saveButton.textContent = toolbarText('saved');
    setSaveEnabled(false);
  });
}

document.addEventListener('mouseup', showTranslationButton);
document.addEventListener('mousedown', e => {
  if (selectionTranslationButton && !selectionTranslationButton.contains(e.target)) hideTranslationButton();
  if (wordCard && !wordCard.contains(e.target)) hideWordCard();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') hideWordCard();
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
  PageTheme.register(inputBox);
  Object.assign(inputBox.style, {
    position: 'fixed',
    top: '20px',
    left: '20px',
    width: '350px',
    height: '60px',
    background: 'var(--coco-input-bg)',
    color: 'var(--coco-text)',
    colorScheme: 'var(--coco-scheme)',
    border: '1px solid var(--coco-border)',
    borderRadius: '8px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    zIndex: '10001',
    transition: 'opacity 0.3s',
    display: 'none'
  });
  // 建立翻譯結果顯示區域
  translationBox = document.createElement('div');
  translationBox.id = 'translation-box';
  PageTheme.register(translationBox);
  Object.assign(translationBox.style, {
    position: 'fixed',
    top: '90px',
    left: '20px',
    width: '350px',
    height: '100px',
    background: 'var(--coco-output-bg)',
    color: 'var(--coco-text)',
    colorScheme: 'var(--coco-scheme)',
    border: '1px solid var(--coco-border)',
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
  if (changed('uiTheme')) PageTheme.setMode(changes.uiTheme.newValue);
  if (changed('targetLanguage')) targetLanguage = changes.targetLanguage.newValue || 'zh-TW';
  if (changed('inputTargetLanguage')) inputTargetLanguage = changes.inputTargetLanguage.newValue || 'en';
  if (changed('triggerKey')) triggerKey = changes.triggerKey.newValue || 'ControlRight';
  if (changed('showOriginalTooltip')) showOriginalTooltip = changes.showOriginalTooltip.newValue !== false;
  if (changed('pageDisplayMode')) {
    pageDisplayMode = changes.pageDisplayMode.newValue === 'bilingual' ? 'bilingual' : 'replace';
    // 翻譯中途切換顯示方式：還原後用新方式重來（譯文都在快取裡，很快）
    if (isPageTranslationMode) {
      restorePage();
      translatePage();
    }
  }
  if (changed('enableSelectionButton')) applySelectionButtonSetting(changes.enableSelectionButton.newValue !== false);
  if (changed('enableFloatingButton')) applyFloatingButtonSetting(changes.enableFloatingButton.newValue !== false);
  if (changed('youTubeSubtitleMode')) YouTubeSubtitles.setMode(changes.youTubeSubtitleMode.newValue);
  if (changed('enableYouTubeSubtitles')) YouTubeSubtitles.setEnabled(changes.enableYouTubeSubtitles.newValue === true);
});

// ---------------- YouTube 雙語字幕 ----------------
// YouTube 原本的 CC 字幕改成透明（還在背景更新，讓我們讀；也還拖得動），
// 在原本的位置顯示「一個」字幕框：原文＋譯文，或只顯示譯文。
// 用整頁翻譯的來源（預設 Google，不耗 AI 額度）；每行翻過就快取，自動產生的滾動字幕也不會一直重翻
const YouTubeSubtitles = (() => {
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const PLAYER_SELECTOR = '#movie_player, .html5-video-player';
  const CAPTION_WINDOW_SELECTOR = '.ytp-caption-window-container .caption-window';
  const HIDE_NATIVE_STYLE_ID = 'coco-yt-hide-native';
  const THROTTLE_MS = 600;
  const cache = new Map();
  let enabled = false;
  let mode = 'bilingual';          // bilingual：原文＋譯文；translation：只顯示譯文
  let player = null;
  let observer = null;
  let box = null;
  let pollTimer = null;
  let throttleTimer = null;
  let frame = null;
  let lastRun = 0;
  let renderId = 0;
  let lastTranslated = '';

  const normalize = text => text.replace(/\s+/g, '');

  const captionLines = () => [...document.querySelectorAll(`${CAPTION_WINDOW_SELECTOR} .caption-visual-line`)]
    .map(line => line.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // 原本的字幕只是變透明：YouTube 照樣更新內容，使用者也照樣能拖曳它的位置
  const hideNativeCaptions = hide => {
    const existing = document.getElementById(HIDE_NATIVE_STYLE_ID);
    if (!hide) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const style = document.createElement('style');
    style.id = HIDE_NATIVE_STYLE_ID;
    style.textContent = '.ytp-caption-window-container { opacity: 0 !important; }';
    (document.head || document.documentElement).appendChild(style);
  };

  const ensureBox = () => {
    if (box && box.isConnected) return box;
    box = document.createElement('div');
    box.id = 'coco-yt-subtitle';
    Object.assign(box.style, {
      position: 'absolute',
      transform: 'translateX(-50%)',
      maxWidth: '90%',
      padding: '0.15em 0.5em',
      background: 'rgba(8, 8, 8, 0.75)',
      color: '#fff',
      textAlign: 'center',
      lineHeight: '1.35',
      borderRadius: '4px',
      pointerEvents: 'none',       // 滑鼠穿透到下面透明的原字幕，拖曳照樣有效
      zIndex: '60',
      display: 'none',
      whiteSpace: 'pre-line'
    });
    const original = document.createElement('div');
    original.className = 'coco-yt-original';
    Object.assign(original.style, { color: '#ddd', fontSize: '0.85em' });
    const translated = document.createElement('div');
    translated.className = 'coco-yt-translated';
    box.append(original, translated);
    player.appendChild(box);
    return box;
  };

  // 每一幀跟著原字幕的位置走（使用者拖曳、控制列出現時 YouTube 會移動它）
  const followNativePosition = () => {
    frame = null;
    if (!box || box.style.display === 'none' || !player) return;
    const captionWindow = document.querySelector(CAPTION_WINDOW_SELECTOR);
    if (captionWindow) {
      const playerRect = player.getBoundingClientRect();
      const captionRect = captionWindow.getBoundingClientRect();
      box.style.left = `${captionRect.left + captionRect.width / 2 - playerRect.left}px`;
      box.style.bottom = `${Math.max(0, playerRect.bottom - captionRect.bottom)}px`;
      // 字體大小、字型都跟原字幕一樣（使用者在 YouTube 設定的字幕樣式照樣有效）
      const segment = captionWindow.querySelector('.ytp-caption-segment');
      if (segment) {
        const style = getComputedStyle(segment);
        box.style.fontSize = style.fontSize;
        box.style.fontFamily = style.fontFamily;
      }
    }
    frame = requestAnimationFrame(followNativePosition);
  };

  const hide = () => {
    if (box) box.style.display = 'none';
  };

  const show = (lines, pending) => {
    const original = lines.join('\n');
    const translations = lines
      .map(line => cache.get(line))
      .filter((text, i) => text && normalize(text) !== normalize(lines[i]));
    // 新的一句還在翻，先留著上一句的譯文，免得一直閃
    let translated = translations.join('\n');
    if (!translated && pending) translated = lastTranslated;
    if (translated) lastTranslated = translated;

    ensureBox();
    const [originalEl, translatedEl] = box.children;
    if (mode === 'translation') {
      // 原字幕藏起來了，翻不出來（或本來就是目標語言）時至少要顯示原文
      originalEl.textContent = '';
      translatedEl.textContent = translated || original;
    } else {
      originalEl.textContent = original;
      translatedEl.textContent = translated;
    }
    originalEl.style.display = originalEl.textContent ? 'block' : 'none';
    translatedEl.style.display = translatedEl.textContent ? 'block' : 'none';
    if (box.style.display === 'none') {
      box.style.display = 'block';
      frame ??= requestAnimationFrame(followNativePosition);
    }
  };

  const render = async () => {
    lastRun = Date.now();
    const lines = captionLines();
    if (!enabled || !lines.length) {
      hide();
      return;
    }
    const id = ++renderId;
    const missing = lines.filter(line => !cache.has(line));
    show(lines, missing.length > 0);
    if (!missing.length) return;

    const { translations, error } = await requestTranslations('page', missing, targetLanguage, 'text', { quiet: true });
    missing.forEach((line, i) => {
      if (!(error && translations[i] === line)) cache.set(line, translations[i]);
    });
    if (id === renderId && enabled) show(lines, false);
  };

  // 字幕一變就更新；逐字滾動的自動字幕最多每 0.6 秒翻一次
  const schedule = () => {
    if (!enabled) return;
    clearTimeout(throttleTimer);
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
    throttleTimer = setTimeout(render, wait);
  };

  const attach = () => {
    const found = document.querySelector(PLAYER_SELECTOR);
    if (!found || found === player) return;
    observer?.disconnect();
    player = found;
    box = null;
    observer = new MutationObserver(mutations => {
      const captionChanged = mutations.some(m => {
        const target = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
        return target?.closest?.('.ytp-caption-window-container');
      });
      if (captionChanged) schedule();
    });
    observer.observe(player, { childList: true, subtree: true, characterData: true });
  };

  const setEnabled = value => {
    enabled = !!value && isYouTube;
    hideNativeCaptions(enabled);
    if (!enabled) {
      observer?.disconnect();
      observer = null;
      player = null;
      clearInterval(pollTimer);
      pollTimer = null;
      clearTimeout(throttleTimer);
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      box?.remove();
      box = null;
      lastTranslated = '';
      return;
    }
    // YouTube 是單頁應用程式，播放器可能晚一點才出現，也可能換掉，定期檢查
    attach();
    pollTimer ??= setInterval(attach, 1000);
    schedule();
  };

  const setMode = value => {
    mode = value === 'translation' ? 'translation' : 'bilingual';
    if (enabled) schedule();
  };

  return { setEnabled, setMode, isYouTube };
})();

if (YouTubeSubtitles.isYouTube) {
  chrome.storage.local.get(['enableYouTubeSubtitles', 'youTubeSubtitleMode'], data => {
    YouTubeSubtitles.setMode(data.youTubeSubtitleMode);
    YouTubeSubtitles.setEnabled(data.enableYouTubeSubtitles === true);
  });
}

// 告訴 background 這是剛載入的新頁面，右鍵選單的整頁翻譯狀態要重設
chrome.runtime.sendMessage({ type: 'CONTENT_READY' }, () => void chrome.runtime.lastError);

// Auto-start page translation for whitelisted sites
chrome.storage.local.get(["siteTranslationList"], async data => {
  if (!SitePatterns.findMatch(data.siteTranslationList, window.location.href)) return;
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
