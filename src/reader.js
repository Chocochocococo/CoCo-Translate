// reader.js — 文件翻譯：PDF（左邊原本的頁面、右邊原文＋譯文）和 TXT（只有右邊）
// 翻譯、選字工具列、單字卡都來自 content.js（同一頁先載入的）；段落整理在 docparse.js
import * as pdfjsLib from './vendor/pdfjs/pdf.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.min.js');

const $ = id => document.getElementById(id);
const BATCH_ITEMS = 30;
const BATCH_CHARS = 5000;

let documentName = '';
let paragraphs = [];          // { page, text, heading, el, transEl, state: 'idle'|'queued'|'done'|'failed' }
let queue = [];
let translating = false;
let observer = null;
let pdfDocument = null;
let pageObserver = null;
let pagesTotal = 0;
let loadId = 0;               // 換檔案時，舊的讀取／翻譯都作廢

// ---------------- 狀態列 ----------------
let statusOverride = '';
const showStatus = () => {
  if (statusOverride) {
    $('status').textContent = statusOverride;
    return;
  }
  if (!paragraphs.length) {
    $('status').textContent = '';
    return;
  }
  const done = paragraphs.filter(p => p.state === 'done').length;
  const progress = i18n('readerProgress', { done, total: paragraphs.length });
  $('status').textContent = pagesTotal ? `${pagesTotal} ${currentUiLang === 'zh' ? '頁' : 'pages'} · ${progress}` : progress;
};
const setStatus = text => {
  statusOverride = text;
  showStatus();
};

const showDropError = message => {
  $('dropError').textContent = message;
  $('dropError').classList.toggle('hidden', !message);
};

// ---------------- 翻譯：畫面附近的段落才翻，一批一批來 ----------------
const sameText = (a, b) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

const pump = async () => {
  if (translating) return;
  translating = true;
  const id = loadId;
  while (queue.length && id === loadId) {
    const batch = [];
    let chars = 0;
    while (queue.length && batch.length < BATCH_ITEMS && chars + queue[0].text.length <= BATCH_CHARS) {
      const para = queue.shift();
      batch.push(para);
      chars += para.text.length;
    }
    if (!batch.length) batch.push(queue.shift());   // 一段就超過上限：自己一批
    const { translations, error } = await requestTranslations('page', batch.map(p => p.text), targetLanguage, 'text');
    if (id !== loadId) break;
    batch.forEach((para, i) => {
      para.el.classList.remove('pending');
      const translated = translations?.[i];
      // 翻譯失敗（錯誤訊息 content.js 會跳）：先標成 failed，下次捲回來或匯出時再試
      if (error && (!translated || translated === para.text)) {
        para.state = 'failed';
        return;
      }
      para.state = 'done';
      if (translated && !sameText(translated, para.text)) para.transEl.textContent = translated;
    });
    showStatus();
  }
  // 換了檔案的話，新的 pump 已經接手了，別把它的旗子放倒
  if (id === loadId) translating = false;
};

const enqueue = para => {
  if (para.state !== 'idle' && para.state !== 'failed') return;
  para.state = 'queued';
  para.el.classList.add('pending');
  queue.push(para);
  pump();
};

// ---------------- 右邊：段落 ----------------
const renderParagraphs = (groups, { single }) => {
  const pane = $('textPane');
  pane.replaceChildren();
  pane.classList.toggle('single', single);
  pane.classList.remove('hidden');
  const column = document.createElement('div');
  column.className = 'column';
  pane.appendChild(column);

  observer?.disconnect();
  observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) enqueue(paragraphs[Number(entry.target.dataset.index)]);
  }), { root: pane, rootMargin: '100% 0px' });

  paragraphs = [];
  groups.forEach(({ page, items }) => {
    if (!items.length) return;
    const block = document.createElement('section');
    block.className = 'page-block';
    if (page) {
      block.dataset.page = page;
      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = i18n('readerPage', { n: page });
      block.appendChild(label);
    }
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = `para coco-reader-text${item.heading ? ' heading' : ''}`;
      el.dataset.index = paragraphs.length;
      const orig = document.createElement('div');
      orig.className = 'orig';
      orig.textContent = item.text;
      const transEl = document.createElement('div');
      transEl.className = 'trans';
      el.append(orig, transEl);
      block.appendChild(el);
      paragraphs.push({ page, text: item.text, heading: item.heading, el, transEl, state: 'idle' });
      observer.observe(el);
    });
    column.appendChild(block);
  });
  showStatus();
};

// ---------------- 左邊：PDF 頁面（捲到附近才畫） ----------------
const renderPdfPage = async (pageNumber, container) => {
  const id = loadId;
  const page = await pdfDocument.getPage(pageNumber);
  if (id !== loadId) return;
  const cssWidth = container.clientWidth || 800;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, (cssWidth / base.width) * (window.devicePixelRatio || 1));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  if (id !== loadId) return;
  container.querySelector('canvas')?.remove();
  container.prepend(canvas);
};

const renderPdfPages = sizes => {
  const pane = $('pdfPane');
  pane.replaceChildren();
  pane.classList.remove('hidden');
  pageObserver?.disconnect();
  pageObserver = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting || entry.target.dataset.rendered) return;
    entry.target.dataset.rendered = '1';
    renderPdfPage(Number(entry.target.dataset.page), entry.target).catch(error => console.warn('CoCo: PDF 頁面畫不出來', error));
  }), { root: pane, rootMargin: '100% 0px' });

  sizes.forEach(({ width, height }, i) => {
    const pageEl = document.createElement('div');
    pageEl.className = 'pdf-page';
    pageEl.dataset.page = i + 1;
    pageEl.style.aspectRatio = `${width} / ${height}`;
    const number = document.createElement('span');
    number.className = 'page-number';
    number.textContent = i + 1;
    pageEl.appendChild(number);
    pane.appendChild(pageEl);
    pageObserver.observe(pageEl);
  });
};

// 左右同步：捲到哪一頁，另一邊就跟到哪一頁
const setupSync = () => {
  const left = $('pdfPane');
  const right = $('textPane');
  let lock = null;
  let frame = null;
  const firstVisible = (pane, selector) => {
    const top = pane.getBoundingClientRect().top;
    return [...pane.querySelectorAll(selector)].find(el => el.getBoundingClientRect().bottom > top + 24);
  };
  const follow = (from, to, fromSelector, toSelector) => {
    if (lock === to) return;   // 是我們自己捲過去的，不要再捲回來
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const current = firstVisible(from, fromSelector);
      if (!current) return;
      const page = Number(current.dataset.page);
      const targets = [...to.querySelectorAll(toSelector)];
      const target = targets.find(el => Number(el.dataset.page) >= page) || targets[targets.length - 1];
      if (!target) return;
      lock = from;
      to.scrollTop = target.offsetTop - 8;
      setTimeout(() => { if (lock === from) lock = null; }, 150);
    });
  };
  left.onscroll = () => follow(left, right, '.pdf-page', '.page-block');
  right.onscroll = () => follow(right, left, '.page-block', '.pdf-page');
};

// ---------------- 開檔 ----------------
const resetView = name => {
  loadId++;
  queue = [];
  translating = false;
  pagesTotal = 0;
  paragraphs = [];
  pdfDocument?.destroy?.();
  pdfDocument = null;
  documentName = name;
  $('docName').textContent = name;
  document.title = `${name} – CoCo`;
  $('exportBtn').disabled = true;
  $('dropZone').classList.add('hidden');
  $('pdfPane').classList.add('hidden');
  $('textPane').classList.add('hidden');
  showDropError('');
};

const showError = message => {
  $('dropZone').classList.remove('hidden');
  $('pdfPane').classList.add('hidden');
  $('textPane').classList.add('hidden');
  showDropError(message);
  setStatus('');
};

const isPdfBytes = bytes => {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
};

const openPdf = async bytes => {
  const id = loadId;
  setStatus(i18n('readerLoading'));
  const pdf = await pdfjsLib.getDocument({
    data: bytes,
    cMapUrl: chrome.runtime.getURL('vendor/pdfjs/cmaps/'),
    cMapPacked: true,
    isEvalSupported: false,   // 擴充功能的 CSP 不准 eval，別讓它試
    standardFontDataUrl: chrome.runtime.getURL('vendor/pdfjs/standard_fonts/')
  }).promise;
  if (id !== loadId) return pdf.destroy();
  pdfDocument = pdf;
  pagesTotal = pdf.numPages;

  const pagesItems = [];
  const sizes = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    setStatus(i18n('readerReading', { n, total: pdf.numPages }));
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    sizes.push({ width, height });
    pagesItems.push((await page.getTextContent()).items);
    if (id !== loadId) return;
  }

  renderPdfPages(sizes);
  const pages = DocParse.paragraphsFromPdfPages(pagesItems);
  const groups = pages.map((items, i) => ({ page: i + 1, items }));
  const textLength = pages.flat().reduce((sum, p) => sum + p.text.length, 0);
  setStatus('');
  if (textLength < 20) {
    // 掃描檔：左邊照樣看得到頁面，右邊說明為什麼沒有譯文
    const pane = $('textPane');
    pane.classList.remove('hidden', 'single');
    const notice = document.createElement('p');
    notice.className = 'warning notice';
    notice.textContent = i18n('readerNoText');
    pane.replaceChildren(notice);
    return;
  }
  renderParagraphs(groups, { single: false });
  setupSync();
  $('exportBtn').disabled = false;
};

const openText = bytes => {
  const text = DocParse.decodeText(bytes);
  renderParagraphs([{ page: 0, items: DocParse.paragraphsFromText(text) }], { single: true });
  setStatus('');
  $('exportBtn').disabled = false;
};

const openBytes = async (bytes, name, type = '') => {
  resetView(name);
  try {
    if (isPdfBytes(bytes) || /\.pdf$/i.test(name) || type === 'application/pdf') {
      await openPdf(bytes);
    } else if (/\.(txt|text|md|markdown|log)$/i.test(name) || type.startsWith('text/')) {
      openText(bytes);
    } else {
      showError(i18n('readerUnsupported'));
    }
  } catch (error) {
    console.error('CoCo: 打不開文件', error);
    showError(i18n('readerLoadFailed', { error: error?.message || String(error) }));
  }
};

const openFile = async file => {
  if (!file) return;
  openBytes(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
};

// 本機檔案只能用 XHR（Chrome 的 fetch 不支援 file://），而且要使用者打開「允許存取檔案網址」
const readLocalFile = url => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';
  xhr.onload = () => (xhr.response?.byteLength ? resolve(new Uint8Array(xhr.response)) : reject(new Error('empty')));
  xhr.onerror = () => reject(new Error('file access denied'));
  xhr.send();
});

const openUrl = async url => {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  resetView(name);
  setStatus(i18n('readerLoading'));
  try {
    if (url.startsWith('file:')) {
      await openBytes(await readLocalFile(url), name);
      return;
    }
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    await openBytes(new Uint8Array(await response.arrayBuffer()), name, type);
  } catch (error) {
    console.error('CoCo: 下載文件失敗', error);
    // 本機檔案（file://）：Firefox 一律不准，Chrome 要另外開「允許存取檔案網址」
    showError(url.startsWith('file:') ? i18n('readerLocalFile') : i18n('readerLoadFailed', { error: error?.message || String(error) }));
  }
};

// ---------------- 匯出：剩下的段落翻完，存成「原文、譯文、空行」的文字檔 ----------------
const exportBilingual = async () => {
  const button = $('exportBtn');
  button.disabled = true;
  paragraphs.forEach(enqueue);
  const id = loadId;
  while (paragraphs.some(p => p.state === 'queued') && id === loadId) {
    const done = paragraphs.filter(p => p.state === 'done').length;
    setStatus(i18n('readerExporting', { done, total: paragraphs.length }));
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  setStatus('');
  button.disabled = false;
  if (id !== loadId) return;
  const lines = [];
  let lastPage = null;
  paragraphs.forEach(para => {
    if (para.page && para.page !== lastPage) {
      lines.push(`── ${i18n('readerPage', { n: para.page })} ──`, '');
      lastPage = para.page;
    }
    lines.push(para.text);
    if (para.transEl.textContent) lines.push(para.transEl.textContent);
    lines.push('');
  });
  const base = documentName.replace(/\.[^.]+$/, '') || 'document';
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${base}.bilingual.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------------- 啟動 ----------------
const start = () => {
  getStorageLang().then(lang => {
    applyLanguage(lang || 'zh');
    if (documentName) document.title = `${documentName} – CoCo`;
    showStatus();
  });

  $('openFileBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', event => {
    openFile(event.target.files[0]);
    event.target.value = '';
  });
  $('exportBtn').addEventListener('click', exportBilingual);

  // 整個視窗都可以拖檔案進來
  let dragDepth = 0;
  document.addEventListener('dragenter', event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dragging');
  });
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    openFile(event.dataTransfer?.files?.[0]);
  });

  const file = new URLSearchParams(location.search).get('file');
  if (file) openUrl(file);
};

start();
