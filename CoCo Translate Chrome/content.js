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
let triggerTranslator, pageTranslator;
let triggerKey = 'ControlRight';
let selectionTranslationButton, floatingButton, inputBox, translationBox, translationBoxContent, tooltip;
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

const applyRegexPatterns = text => new Promise(resolve => {
  if (!text) return resolve('');
  chrome.storage.local.get(['enableCustomRegex', 'regexPatterns'], data => {
    if (data.enableCustomRegex === false) {
      return resolve(text);
    }
    let updatedText = text;
    (data.regexPatterns || []).forEach(pattern => {
      if (pattern.enabled) {
        try {
          updatedText = updatedText.replace(new RegExp(pattern.input, 'g'), pattern.output);
        } catch (e) {
          console.error('Invalid regex pattern:', e);
        }
      }
    });
    resolve(updatedText);
  });
});

// Translation functions
async function translateTextareas() {
  const textareas = document.querySelectorAll('textarea');
  for (const textarea of textareas) {
    const originalValue = textarea.value;
    if (originalValue.trim() !== "") {
      if (!originalTextareaMap.has(textarea)) {
        originalTextareaMap.set(textarea, originalValue);
      } 
      try {
        const translated = await pageTranslator.translate(originalValue, targetLanguage);
        textarea.value = translated;
      } catch (error) {
        console.error('翻譯 textarea 時出錯：', error);
      }
    }
  }
}

async function translateElementAttributes() {
  const selectors = '[placeholder], [title], [display-name], [description]';
  const elements = document.querySelectorAll(selectors);
  for (const element of elements) {
    const attributes = ['placeholder', 'title', 'display-name', 'description'];
    for (const attr of attributes) {
      if (element.hasAttribute(attr)) {
        const originalText = element.getAttribute(attr);
        if (originalText && originalText.trim() !== "") {
          if (!originalAttributesMap.has(element)) {
            originalAttributesMap.set(element, {});
          }
          originalAttributesMap.get(element)[attr] = originalText;
          try {
            const translatedText = await pageTranslator.translate(originalText, targetLanguage);
            element.setAttribute(attr, translatedText);
          } catch (error) {
            console.error(`翻譯屬性 ${attr} 時出錯：`, error);
          }
        }
      }
    }
  }
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
  // 如果現在是整頁翻譯模式，那就不要用 triggerTranslator
  if (isPageTranslationMode) {
    // 你要嘛就單純原樣返回
    // return container.innerHTML;

    // 如果想做「還是翻譯一下」的話，就可以用 pageTranslator:
    const walkNodes = async node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const t = await pageTranslator.translate(node.textContent.trim(), targetLanguage);
        node.textContent = t;
      }
      for (const child of node.childNodes) {
        await walkNodes(child);
      }
    };
    await walkNodes(container);
    return container.innerHTML;
  }
  if (triggerTranslator.constructor.name === "MistralTranslator") {
    // 定義獨特的分隔符
    const delimiter = "|||---DELIM---|||";
    
    // 收集所有需要翻譯的文字節點
    const textNodes = [];
    const gatherTextNodes = node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        textNodes.push(node);
      }
      node.childNodes.forEach(child => gatherTextNodes(child));
    };
    gatherTextNodes(container);
    
    if (textNodes.length === 0) {
      return container.innerHTML;
    }
    
    // 拼接所有文字節點，中間插入分隔符
    const texts = textNodes.map(node => node.textContent.trim());
    const combinedText = texts.join(delimiter);
    
    // 呼叫 MistralTranslator 翻譯
    let combinedTranslation = await triggerTranslator.translate(combinedText, targetLanguage);
    
    // 移除開頭與結尾可能多餘的分隔符
    combinedTranslation = combinedTranslation.replace(new RegExp(`^(?:${delimiter})+`), '').replace(new RegExp(`(?:${delimiter})+$`), '');
    
    // 根據分隔符分割譯文，並過濾掉空白段落
    let translatedSegments = combinedTranslation.split(delimiter).map(seg => seg.trim()).filter(seg => seg !== "");
    
    for (let i = 0; i < textNodes.length; i++) {
      textNodes[i].textContent = translatedSegments[i] || "";
    }    
    
    return container.innerHTML;
  } else {
    // 非 MistralTranslator 時，逐節點翻譯
    const walkNodes = async node => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        const t = await triggerTranslator.translate(node.textContent.trim(), targetLanguage);
        node.textContent = t;
      }    
      for (const child of node.childNodes) {
        await walkNodes(child);
      }
    };
    await walkNodes(container);
    return container.innerHTML;
  }
};

const translatePage = async () => {
  isRestoring = false;
  isPageTranslationMode = true;
  await translateElementRecursively_OnlyPageTranslator(document.body);
  translateTextareas();
  translateElementAttributes();
  startAutoTranslationObserver();
  hideTranslationButton();
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
    for (const node of nodes) {
      // 一律只用 pageTranslator
      if (node.nodeType === Node.ELEMENT_NODE) {
        await translateElementRecursively_OnlyPageTranslator(node);
      } else if (node.nodeType === Node.TEXT_NODE) {
        await translateTextNode_OnlyPageTranslator(node);
      }
    }
  }, 300);
  });
  pageTranslationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
};

// 然後你把 translateElementRecursively() / translateTextNode() 改成只用 pageTranslator
async function translateElementRecursively_OnlyPageTranslator(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const tasks = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (translationBox && translationBox.contains(node)) continue;

    const currentText = node.textContent.trim();
    if (!currentText) continue;

    // 假如有存過 originalText，就判斷是否已經被改掉
    if (originalTextMap.has(node)) {
      const storedOriginal = originalTextMap.get(node);
      // 若現在文字已經不是之前存的原文，代表可能翻譯過或被使用者改
      if (currentText !== storedOriginal) {
        // 那就他媽的跳過，別再翻了
        continue;
      }
    } else {
      // 如果這是我們第一次看見這個 node，就把它現在的文字當作「原文」
      originalTextMap.set(node, currentText);
    }

    // 走到這裡，代表此 node 的文字依然跟「原文」一樣，
    // 所以我們才需要翻譯
    tasks.push(
      pageTranslator.translate(currentText, targetLanguage)
        .then(t => { node.textContent = t; })
        .catch(err => console.error("Translation error:", err))
    );
  }
  await Promise.all(tasks);
}

async function translateTextNode_OnlyPageTranslator(node) {
  const currentText = node.textContent.trim();
  if (!currentText) return;

  // 同樣加上判斷
  if (originalTextMap.has(node)) {
    const storedOriginal = originalTextMap.get(node);
    if (currentText !== storedOriginal) {
      // 翻譯後文字 != 原文 => skip
      return;
    }
  } else {
    // 第一次看到這個 node，就把現在的文字存為原文
    originalTextMap.set(node, currentText);
  }

  try {
    const translated = await pageTranslator.translate(currentText, targetLanguage);
    node.textContent = translated;
  } catch (err) {
    console.error("Translation error:", err);
  }
}


const stopAutoTranslationObserver = () => {
  if (pageTranslationObserver) {
    pageTranslationObserver.disconnect();
    pageTranslationObserver = null;
  }
  pendingNodes = [];
  clearTimeout(debounceTimer);
};

// Message listener
chrome.runtime.onMessage.addListener(async message => {
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
        if (selElem) await handleTranslation(selElem);
      }
      break;
    case "CLEAR_ALL_TRANSLATIONS":
      removeAllTranslations();
      break;
      case "TRANSLATE_PAGE":
        await translatePage();
        break;      
    case "RESTORE_PAGE":
      restorePage();
      break;
    case "DISABLE_AUTO_TRANSLATION":
      disableAutoTranslation();
      break;
      case "UPDATE_TRIGGER_TRANSLATION_SOURCE":
        {
        const source = message.translationSource;
        if (source === 'bing') {
          triggerTranslator = new BingTranslator();
        } else if (source === 'google-api') {
          chrome.storage.local.get(['googleApiKey'], data => {
            const apiKey = data.googleApiKey || '';
            triggerTranslator = new GoogleApiKeyTranslator(apiKey);
          });
        } else if (source === 'deepl-api') {
          chrome.storage.local.get(['deepLApiKey'], data => {
            const apikey = data.deepLApiKey || '';
            triggerTranslator = new DeepLTranslator(apikey);
          });
        } else if (source === 'mistral-api') {
          chrome.storage.local.get(['mistralApiKey'], data => {
            const apiKey = data.mistralApiKey || '';
            triggerTranslator = new MistralTranslator(apiKey);
          });
        } else {
          triggerTranslator = new GoogleTranslator();
        }
      }
        break;
      case "UPDATE_PAGE_TRANSLATION_SOURCE":
        {
        const source = message.translationSource;
        if (source === 'bing') {
          pageTranslator = new BingTranslator();
        } else if (source === 'google-api') {
          chrome.storage.local.get(['googleApiKey'], data => {
            const apiKey = data.googleApiKey || '';
            pageTranslator = new GoogleApiKeyTranslator(apiKey);
          });
        } else if (source === 'deepl-api') {
          chrome.storage.local.get(['deepLApiKey'], data => {
            const apikey = data.deepLApiKey || '';
            pageTranslator  = new DeepLTranslator(apikey);
          });
        } else if (source === 'mistral-api') {
          console.warn('Fuck! Mistral 不支援整頁翻譯，改用 GoogleTranslator！');
          pageTranslator = new GoogleTranslator();
        } else {
          pageTranslator = new GoogleTranslator();
        }
      }
      break;            
    case 'UPDATE_SHOW_ORIGINAL_TOOLTIP':
      showOriginalTooltip = message.showOriginalTooltip;
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

const setupOutsideClickListener = () => {
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
    const translated = await triggerTranslator.translateInputText(text, inputTargetLanguage);
    translationBoxContent.textContent = translated;
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

chrome.storage.local.get(['enableFloatingButton'], data => {
  updateFloatingButton(data.enableFloatingButton !== false);
  if (data.enableFloatingButton !== false) createTranslationBoxes();
});

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'TOGGLE_FLOATING_BUTTON') {
    updateFloatingButton(message.isEnabled);
    if (message.isEnabled) createTranslationBoxes();
    else {
      if (inputBox) inputBox.remove();
      if (translationBox) translationBox.remove();
      if (translateBtn) translateBtn.remove();
    }
  }
  if (message.type === 'UPDATE_SELECTION_BUTTON') {
    enableSelectionButton = message.enableSelectionButton;
    if (!enableSelectionButton && selectionTranslationButton) {
      selectionTranslationButton.remove();
      selectionTranslationButton = null;
    }
  }
});

// Auto-start page translation for whitelisted sites
chrome.storage.local.get(["siteTranslationList"], data => {
  const list = data.siteTranslationList || [];
  if (list.includes(window.location.origin)) translatePage();
});

// 初始化觸發式翻譯 API（支援：google, google-api, bing, deepl-api, mistral-api）
chrome.storage.local.get(['triggerTranslationSource'], data => {
  const tSource = data.triggerTranslationSource || 'google';
  if (tSource === 'bing') {
    triggerTranslator = new BingTranslator();
  } else if (tSource === 'google-api') {
    chrome.storage.local.get(['googleApiKey'], data => {
      const apiKey = data.googleApiKey || '';
      triggerTranslator = new GoogleApiKeyTranslator(apiKey);
    });
  } else if (tSource === 'deepl-api') {
    chrome.storage.local.get(['deepLApiKey'], data => {
      const apiKey = data.deepLApiKey || '';
      triggerTranslator = new DeepLTranslator(apiKey);
    });
  } else if (tSource === 'mistral-api') {
    chrome.storage.local.get(['mistralApiKey'], data => {
      const apiKey = data.mistralApiKey || '';
      triggerTranslator = new MistralTranslator(apiKey);
    });
  } else {
    triggerTranslator = new GoogleTranslator();
  }
});

// 初始化整頁翻譯 API（僅提供：google, google-api, bing）
chrome.storage.local.get(['pageTranslationSource'], data => {
  const pSource = data.pageTranslationSource || 'google';
  if (pSource === 'bing') {
    pageTranslator = new BingTranslator();
  } else if (pSource === 'google-api') {
    chrome.storage.local.get(['googleApiKey'], data => {
      const apiKey = data.googleApiKey || '';
      pageTranslator = new GoogleApiKeyTranslator(apiKey);
    });
  } else if (pSource === 'deepl-api') {
    chrome.storage.local.get(['deepLApiKey'], data => {
      const apiKey = data.deepLApiKey || '';
      pageTranslator = new DeepLTranslator(apiKey);
    });
  }else {
    pageTranslator = new GoogleTranslator();
  }
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

/*chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CLEAR_TRANSLATION_CACHE') {
    console.log('Content Script: Received CLEAR_TRANSLATION_CACHE message, clearing DB store, fuck yeah!');
    if (window.TranslationCache && window.TranslationCache.cache && window.TranslationCache.cache.db) {
      const db = window.TranslationCache.cache.db;
      const tx = db.transaction([window.TranslationCache.cache.storeName], 'readwrite');
      const store = tx.objectStore(window.TranslationCache.cache.storeName);
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        console.log('Content Script: Translation cache store cleared successfully!');
        sendResponse({ success: true });
      };
      clearRequest.onerror = (e) => {
        console.error('Content Script: Failed to clear translation cache store:', e);
        sendResponse({ success: false });
      };
      return true; // 回傳 true 以便進行非同步回應
    } else {
      console.warn('Content Script: No active DB connection found!');
      sendResponse({ success: false });
    }
  }
});*/


