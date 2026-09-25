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
  initRegexImport();
});
