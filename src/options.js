// options.js — 設定頁：網站清單、匯入正規表達式（之後的術語表、生字本也放這裡）
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
  Object.assign(modal.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '9999'
  });

  // 建立內容容器
  const content = document.createElement('div');
  Object.assign(content.style, {
    backgroundColor: '#fff',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    textAlign: 'center',
    maxWidth: '420px'
  });
  const paragraph = document.createElement('p');
  paragraph.style.margin = '0 0 10px';
  paragraph.style.whiteSpace = 'pre-line';
  paragraph.textContent = message;
  content.appendChild(paragraph);

  // 建立 OK 按鈕
  const okButton = document.createElement('button');
  okButton.textContent = 'OK';
  okButton.className = 'btn';
  okButton.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  content.appendChild(okButton);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

let uiLang = 'zh';
const t = (zh, en) => (uiLang === 'zh' ? zh : en);

// 小工具：建立一列「內容 + 刪除按鈕」
function createListItem(contentNodes, onDelete) {
  const item = document.createElement('li');
  const grow = document.createElement('div');
  grow.className = 'grow';
  grow.append(...contentNodes);
  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn secondary small';
  deleteButton.textContent = t('刪除', 'Delete');
  deleteButton.addEventListener('click', onDelete);
  item.append(grow, deleteButton);
  return item;
}

// ---------------- 分頁切換 ----------------
function showSection(id) {
  const sections = [...document.querySelectorAll('.panel')];
  const target = sections.find(section => section.id === id) || sections[0];
  sections.forEach(section => section.classList.toggle('active', section === target));
  document.querySelectorAll('.side-nav a').forEach(link => {
    link.classList.toggle('active', link.dataset.section === target.id);
  });
}

// ---------------- 總是翻譯的網站 ----------------
function initSites() {
  const input = document.getElementById('siteInput');
  const list = document.getElementById('siteList');
  const empty = document.getElementById('siteListEmpty');

  const render = sites => {
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
    empty.style.display = sites.length ? 'none' : 'block';
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

  document.getElementById('addSiteBtn').addEventListener('click', add);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') add();
  });

  chrome.storage.local.get(['siteTranslationList'], data => render(data.siteTranslationList || []));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.siteTranslationList) render(changes.siteTranslationList.newValue || []);
  });
}

// ---------------- 術語表 ----------------
// 小工具：把 JSON 存成檔案下載
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

function initGlossary() {
  const source = document.getElementById('glossarySource');
  const target = document.getElementById('glossaryTarget');
  const site = document.getElementById('glossarySite');
  const list = document.getElementById('glossaryList');
  const empty = document.getElementById('glossaryEmpty');

  const save = entries => chrome.storage.local.set({ glossary: entries });
  const load = callback => chrome.storage.local.get(['glossary'], data => callback(data.glossary || []));

  const render = entries => {
    list.innerHTML = '';
    entries.forEach((entry, index) => {
      const text = document.createElement('span');
      text.textContent = `${entry.source} → ${entry.target}`;
      const scope = document.createElement('code');
      scope.style.marginLeft = '8px';
      scope.textContent = entry.site || t('所有網站', 'all sites');
      list.appendChild(createListItem([text, scope], () => {
        load(current => save(current.filter((_, i) => i !== index)));
      }));
    });
    empty.style.display = entries.length ? 'none' : 'block';
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

  document.getElementById('addGlossaryBtn').addEventListener('click', add);
  [source, target, site].forEach(input => input.addEventListener('keydown', e => {
    if (e.key === 'Enter') add();
  }));

  document.getElementById('exportGlossaryBtn').addEventListener('click', () => {
    load(entries => downloadFile('coco-glossary.json', JSON.stringify(entries, null, 2)));
  });

  const importFile = document.getElementById('importGlossaryFile');
  document.getElementById('importGlossaryBtn').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) throw new Error('not an array');
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
      } catch (error) {
        showCustomWarning(t('檔案格式不對，請選擇匯出的術語表 JSON。', 'Invalid file. Please choose an exported glossary JSON.'));
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });

  load(render);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.glossary) render(changes.glossary.newValue || []);
  });
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
  const list = document.getElementById('vocabularyList');
  const empty = document.getElementById('vocabularyEmpty');
  const count = document.getElementById('vocabularyCount');
  let current = [];

  const render = vocabulary => {
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
    empty.style.display = vocabulary.length ? 'none' : 'block';
    count.textContent = vocabulary.length ? t(`共 ${vocabulary.length} 個字`, `${vocabulary.length} words`) : '';
  };

  document.getElementById('exportAnkiBtn').addEventListener('click', () => {
    if (!current.length) {
      showCustomWarning(t('生字本還是空的。', 'Your vocabulary is empty.'));
      return;
    }
    downloadFile('coco-vocabulary.txt', toAnkiText(current), 'text/plain');
  });

  document.getElementById('clearVocabularyBtn').addEventListener('click', () => {
    if (!current.length) return;
    if (!confirm(t(`確定要刪除全部 ${current.length} 個字嗎？`, `Delete all ${current.length} words?`))) return;
    chrome.storage.local.set({ vocabulary: [] });
  });

  chrome.storage.local.get(['vocabulary'], data => render(data.vocabulary || []));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.vocabulary) render(changes.vocabulary.newValue || []);
  });
}

// ---------------- 匯入正規表達式 ----------------
function initRegexImport() {
  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return; // 未選擇檔案
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const imported = JSON.parse(evt.target.result);
        if (!Array.isArray(imported)) {
          showCustomWarning('Invalid JSON format (not an array).');
          return;
        }
        chrome.storage.local.set({ regexPatterns: imported }, () => {
          showCustomWarning(`Imported ${imported.length} patterns successfully!`);
        });
      } catch (error) {
        showCustomWarning('Error reading file: ' + error);
        console.error('Import error:', error);
      }
      importFile.value = '';
    };
    reader.readAsText(file);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  getStorageLang().then(savedLang => {
    uiLang = savedLang || 'zh';
    applyLanguage(uiLang);
  });
  showSection(location.hash.slice(1));
  window.addEventListener('hashchange', () => showSection(location.hash.slice(1)));
  initSites();
  initGlossary();
  initVocabulary();
  initRegexImport();
});
