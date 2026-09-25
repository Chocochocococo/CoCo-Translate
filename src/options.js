// options.js — 匯入正規表達式（popup 開檔案對話框時，Firefox 會把 popup 關掉，所以搬到這一頁）
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
    textAlign: 'center'
  });
  const paragraph = document.createElement('p');
  paragraph.style.margin = '0 0 10px';
  paragraph.textContent = message;
  content.appendChild(paragraph);

  // 建立 OK 按鈕
  const okButton = document.createElement('button');
  okButton.textContent = 'OK';
  Object.assign(okButton.style, { padding: '5px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer' });
  okButton.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  content.appendChild(okButton);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

document.addEventListener('DOMContentLoaded', () => {
  getStorageLang().then((savedLang) => {
    applyLanguage(savedLang || "zh");
  });

  const importFile = document.getElementById('importFile');
  const importBtn = document.getElementById('importBtn');

  importBtn.addEventListener('click', () => {
    // 讓使用者自行選擇檔案
    importFile.click();
  });

  importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return; // 未選擇檔案

    const reader = new FileReader();
    reader.onload = (evt) => {
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
});
