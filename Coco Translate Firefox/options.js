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
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.zIndex = '9999';

  // 建立內容容器
  const content = document.createElement('div');
  content.style.backgroundColor = '#fff';
  content.style.padding = '20px';
  content.style.borderRadius = '8px';
  content.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  content.style.textAlign = 'center';
  content.innerHTML = `<p style="margin: 0 0 10px;">${message}</p>`;

  // 建立 OK 按鈕
  const okButton = document.createElement('button');
  okButton.textContent = 'OK';
  okButton.style.padding = '5px 10px';
  okButton.style.border = 'none';
  okButton.style.borderRadius = '4px';
  okButton.style.cursor = 'pointer';
  okButton.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  content.appendChild(okButton);
  modal.appendChild(content);
  document.body.appendChild(modal);
}

document.addEventListener('DOMContentLoaded', () => {
  getStorageLang().then((savedLang) => {
    savedLang = savedLang || "zh";
    // 直接呼叫套用語言
    applyLanguage(savedLang);
  });
  
  function renderModalPatternList(patterns) {
    const modalPatternList = document.getElementById('modalPatternList');
    if (!modalPatternList) return;
    modalPatternList.innerHTML = patterns.map((pattern, index) => `
      <div class="pattern-item">
        <input type="checkbox" class="pattern-enabled" data-index="${index}" ${pattern.enabled ? 'checked' : ''}>
        <input type="text" class="pattern-input" placeholder="Input Regex" value="${pattern.input}" data-index="${index}">
        <input type="text" class="pattern-output" placeholder="Output Replacement" value="${pattern.output}" data-index="${index}">
        <button class="pattern-delete" data-index="${index}">Delete</button>
      </div>
    `).join('');
    // 可以在此處補充為各個元件加上事件監聽
  }
    const importFile = document.getElementById('importFile');
    const importBtn = document.getElementById('importBtn');
  
    importBtn.addEventListener('click', () => {
      // 讓使用者自行選擇檔案
      importFile.click();
    });
  
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return; // 未選擇檔案
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          if (!Array.isArray(imported)) {
            showCustomWarning('Invalid JSON format (not an array).');
            return;
          }
          await browser.storage.local.set({ regexPatterns: imported });
          showCustomWarning('Imported successfully!');
          // 如果正規表達式編輯區塊處於隱藏狀態，自動顯示它
          const regexModal = document.getElementById('regexEditorModal');
          if (regexModal && regexModal.classList.contains('hidden')) {
            regexModal.classList.remove('hidden');
            // 立即渲染，讓使用者看到匯入結果
            renderModalPatternList(imported);
            // 可以在一定時間後自動隱藏，例如 2 秒後
            setTimeout(() => { regexModal.classList.add('hidden'); }, 2000);
          } else {
            renderModalPatternList(imported);
          }
        } catch (error) {
          showCustomWarning('Error reading file: ' + error);
          console.error('Import error:', error);
        }
      };
      reader.readAsText(file);
    });
  });
  