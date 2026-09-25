// Chromium 端對端測試：載入 dist/chrome，用本機假的 OpenAI 相容伺服器當翻譯來源
// 用法：npm run build:chrome && node tests/e2e/chrome.e2e.mjs
// 需要 playwright（npm i -g playwright 或專案內安裝）
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(path.join(process.env.NPM_GLOBAL || '', 'playwright'));
  }
})();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT_DIR = path.join(ROOT, 'dist', 'chrome');

// <html translate="no">：很多網站這樣寫只是為了擋 Chrome 內建翻譯，CoCo 還是要照翻
const PAGE = `<!doctype html><html translate="no"><head><style>p { color: black; }</style></head><body>
  <p id="p1">Hello <b>brave</b> world</p>
  <p id="order">He said <b id="bold">hello</b> to <i id="italic">her</i>.</p>
  <p id="broken">Click <a href="#top" id="link">here</a> now</p>
  <div id="novel">First line of the chapter<br>Second line of the chapter</div>
  <p id="p2">The quick brown fox</p>
  <p id="num">42</p>
  <p id="code">Run <code>npm test</code> now</p>
  <p id="notranslate" class="notranslate">Marked as notranslate</p>
  <pre id="block"><code>Print the greeting</code></pre>
  <pre id="poem">Roses are red
Violets are blue</pre>
  <div id="editor" contenteditable="true"><p>Write your story here</p></div>
  <input id="field" placeholder="Search here">
  <div id="far" style="margin-top: 5000px"><p id="farp">Far below the fold</p></div>
</body></html>`;

// ---------- 假的 LLM 伺服器 ----------
const llmRequests = [];
let llmMode = 'ok';
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-large' }, { id: 'mock-small:free' }] }));
    }
    const payload = JSON.parse(body);
    llmRequests.push(payload);
    if (llmMode === 'unauthorized') {
      res.writeHead(401);
      return res.end('invalid api key');
    }
    const user = payload.messages[1].content;
    let content;
    // 模擬真實翻譯服務：中文語序會讓標籤換位置；偶爾也會把標籤弄丟
    const translateSegment = s => {
      if (s.startsWith('He said <b id="g0">')) return '他對<i id="g1">她</i>說<b id="g0">你好</b>。';
      if (s.includes('<a id="g0">')) return '[譯]Click here now';
      return `[譯]${s}`;
    };
    if (payload.response_format) {
      const { segments } = JSON.parse(user);
      content = JSON.stringify({ segments: segments.map(translateSegment) });
    } else {
      content = `[譯]${user.split('\n').slice(1).join('\n')}`;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
}).listen(0);

const pageServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(PAGE);
}).listen(0);

const origin = `http://127.0.0.1:${pageServer.address().port}`;
const llmBaseUrl = `http://127.0.0.1:${llmServer.address().port}/v1`;

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coco-e2e-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`]
});

const errors = [];
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`✔ ${name}`);
  } catch (error) {
    results.push(`✘ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
  }
};

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  const extId = sw.url().split('/')[2];

  await sw.evaluate(({ origin, llmBaseUrl }) => chrome.storage.local.set({
    triggerTranslationSource: 'llm',
    pageTranslationSource: 'llm',
    llmSettings: { provider: 'ollama-local', providers: { 'ollama-local': { baseUrl: llmBaseUrl, model: 'mock' } } },
    siteTranslationList: [origin]
  }), { origin, llmBaseUrl });

  const page = await context.newPage();
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  const originalHTML = PAGE.match(/<body>([\s\S]*)<\/body>/)[1];

  // 1. 總是翻譯此網站 + AI 整頁翻譯
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#p2').textContent.startsWith('[譯]'), null, { timeout: 5000 });
  await page.waitForTimeout(300);

  await check('段落翻譯：整段一起翻，行內樣式和空白都保留', async () => {
    assert.equal(await page.textContent('#p1'), '[譯]Hello brave world');
    assert.equal(await page.textContent('#p1 b'), 'brave');
  });
  await check('段落翻譯：標籤跟著中文語序換位置，而且是原本的元素', async () => {
    assert.equal(await page.textContent('#order'), '他對她說你好。');
    assert.equal(await page.textContent('#italic'), '她');
    assert.equal(await page.textContent('#bold'), '你好');
    const order = await page.$$eval('#order > *', els => els.map(el => el.id));
    assert.deepEqual(order, ['italic', 'bold']);
  });
  await check('段落翻譯：標籤對不回去就退回逐片段翻，連結還在', async () => {
    assert.equal(await page.textContent('#broken'), '[譯]Click [譯]here [譯]now');
    assert.equal(await page.getAttribute('#link', 'href'), '#top');
  });
  await check('段落翻譯：<br> 隔開的每一行各自是一段', async () => {
    assert.equal(await page.textContent('#novel'), '[譯]First line of the chapter[譯]Second line of the chapter');
    assert.equal(await page.locator('#novel br').count(), 1);
  });
  await check('段落翻譯：<pre> 的換行保留', async () => {
    assert.equal(await page.textContent('#poem'), '[譯]Roses are red\nViolets are blue');
  });
  await check('整頁翻譯：<html translate="no"> 和 .notranslate 照翻', async () => {
    assert.equal(await page.textContent('#notranslate'), '[譯]Marked as notranslate');
  });
  await check('整頁翻譯：程式碼區塊照翻', async () => {
    assert.equal(await page.textContent('#code'), '[譯]Run npm test now');
    // 假伺服器把 [譯] 加在整段最前面（<code> 外面），所以看整個 <pre>
    assert.equal(await page.textContent('#block'), '[譯]Print the greeting');
    assert.equal(await page.textContent('#block code'), 'Print the greeting');
  });
  await check('整頁翻譯：編輯器裡的預設文字照翻', async () => {
    assert.equal(await page.textContent('#editor'), '[譯]Write your story here');
  });
  await check('整頁翻譯：純數字不翻', async () => {
    assert.equal(await page.textContent('#num'), '42');
  });
  await check('整頁翻譯：<style> 內容不能被翻', async () => {
    assert.equal(await page.evaluate(() => document.querySelector('style').textContent), 'p { color: black; }');
  });
  await check('整頁翻譯：屬性也有翻', async () => {
    assert.equal(await page.getAttribute('#field', 'placeholder'), '[譯]Search here');
  });
  await check('整頁翻譯：所有段落只用一次 AI 請求（整段模式）', async () => {
    const markupRequests = llmRequests.filter(r => r.messages[0].content.includes('inline HTML tags'));
    assert.equal(markupRequests.length, 1, `整段模式的請求數 ${markupRequests.length}`);
    assert.ok(markupRequests[0].response_format, '應該用 JSON 分段模式');
  });

  // 1-1. 只翻畫面附近的段落
  await check('只翻畫面附近：很下面的段落一開始不翻', async () => {
    assert.equal(await page.textContent('#farp'), 'Far below the fold');
  });
  await page.evaluate(() => document.querySelector('#farp').scrollIntoView());
  await check('只翻畫面附近：捲到附近才翻', async () => {
    await page.waitForFunction(() => document.querySelector('#farp').textContent === '[譯]Far below the fold', null, { timeout: 3000 });
  });
  await page.evaluate(() => window.scrollTo(0, 0));

  // 2. 動態新增的內容
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'dynamic';
    p.textContent = 'Loaded later';
    document.body.prepend(p);
  });
  await check('整頁翻譯：之後才載入的內容也會翻', async () => {
    await page.waitForFunction(() => document.querySelector('#dynamic').textContent === '[譯]Loaded later', null, { timeout: 3000 });
  });

  // 2-1. 使用者在編輯器裡打字，不能被自動翻掉
  await page.click('#editor');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('My own words');
  await page.waitForTimeout(1000);
  await check('編輯器：正在打的字不會被翻掉', async () => {
    assert.match(await page.textContent('#editor'), /My own words$/);
    assert.doesNotMatch(await page.textContent('#editor'), /\[譯\]My own words/);
  });
  await page.evaluate(() => document.activeElement.blur());

  // 2-2. 晚一點才載入的編輯器（沒在打字），預設文字要翻
  await page.evaluate(() => {
    const editor = document.createElement('div');
    editor.id = 'late-editor';
    editor.contentEditable = 'true';
    editor.textContent = 'Share your thoughts';
    document.body.prepend(editor);
  });
  await check('編輯器：之後才載入的編輯器預設文字也會翻', async () => {
    await page.waitForFunction(() => document.querySelector('#late-editor').textContent === '[譯]Share your thoughts', null, { timeout: 3000 });
  });

  // 3. 還原
  const tabId = await sw.evaluate(async o => (await chrome.tabs.query({ url: o + '/*' }))[0].id, origin);
  await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'RESTORE_PAGE' }), tabId);
  await page.waitForTimeout(300);
  await check('還原：節點數量跟原本一樣（沒有殘留新增的文字節點）', async () => {
    assert.equal(await page.evaluate(() => document.querySelector('#order').childNodes.length), 5);
    assert.deepEqual(await page.$$eval('#order > *', els => els.map(el => el.id)), ['bold', 'italic']);
  });
  await check('還原：文字與空白完全回到原樣', async () => {
    const body = await page.evaluate(() => {
      document.querySelector('#dynamic')?.remove();
      document.querySelector('#late-editor')?.remove();
      // 使用者自己打的字不算原文
      const editor = document.querySelector('#editor');
      [...editor.childNodes].slice(1).forEach(n => n.remove());
      return [...document.body.childNodes]
        // 只比對網頁原本的內容，CoCo 自己的介面（輸入框翻譯、提示）不算
        .filter(n => n.nodeType === 3 || (/^(P|PRE|DIV|INPUT)$/.test(n.nodeName) && !/^(translation-box|copy-tooltip|coco-error-toast)$/.test(n.id)))
        .map(n => n.outerHTML ?? n.textContent).join('');
    });
    assert.equal(body.replace(/\s+/g, ' ').trim(), originalHTML.replace(/\s+/g, ' ').trim());
  });

  // 3-1. 雙語對照
  await page.evaluate(() => window.scrollTo(0, 0));
  await sw.evaluate(() => chrome.storage.local.set({ pageDisplayMode: 'bilingual' }));
  await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'TRANSLATE_PAGE' }), tabId);
  await page.waitForSelector('#p1 .coco-bilingual', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await check('雙語對照：原文不動，譯文插在下方', async () => {
    assert.equal(await page.evaluate(() => document.querySelector('#p1').firstChild.textContent), 'Hello ');
    assert.equal(await page.textContent('#p1 .coco-bilingual'), '[譯]Hello brave world');
    assert.equal(await page.textContent('#p1 .coco-bilingual b'), 'brave');
  });
  await check('雙語對照：譯文照中文語序，樣式跟著走，原文順序不變', async () => {
    assert.equal(await page.textContent('#order .coco-bilingual'), '他對她說你好。');
    assert.equal(await page.textContent('#order .coco-bilingual i'), '她');
    assert.equal(await page.locator('#order .coco-bilingual [id]').count(), 0, '複製的元素不能帶重複的 id');
    assert.deepEqual(await page.$$eval('#order > [id]', els => els.map(el => el.id)), ['bold', 'italic']);
  });
  await check('雙語對照：標籤對不回去就放純文字', async () => {
    assert.equal(await page.textContent('#broken .coco-bilingual'), '[譯]Click here now');
    assert.equal(await page.textContent('#link'), 'here');
  });
  await check('雙語對照：<br> 分行的每一行各有譯文', async () => {
    assert.equal(await page.locator('#novel .coco-bilingual').count(), 2);
  });
  await sw.evaluate(() => commandHandlers['toggle-display-mode']());
  await check('雙語對照：用快捷鍵切回取代原文', async () => {
    await page.waitForFunction(() => document.querySelector('#order').textContent === '他對她說你好。', null, { timeout: 3000 });
    assert.equal(await page.locator('.coco-bilingual').count(), 0);
    const { pageDisplayMode } = await sw.evaluate(() => chrome.storage.local.get('pageDisplayMode'));
    assert.equal(pageDisplayMode, 'replace');
  });
  await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'RESTORE_PAGE' }), tabId);
  await page.waitForTimeout(300);
  await check('雙語對照：還原後回到原文', async () => {
    assert.equal(await page.textContent('#order'), 'He said hello to her.');
  });

  // 4. 觸發式翻譯（滑鼠 + 右 Ctrl）
  await sw.evaluate(() => chrome.storage.local.set({ siteTranslationList: [] }));
  await page.reload();
  await page.waitForTimeout(500);
  // 整頁翻譯過的段落都在快取裡了，另外加兩段沒翻過的
  await page.evaluate(() => {
    for (const [id, text] of [['fresh', 'Jumps over the lazy dog'], ['fresh2', 'Something brand new']]) {
      const p = document.createElement('p');
      p.id = id;
      p.textContent = text;
      document.body.appendChild(p);
    }
  });
  const before = llmRequests.length;
  await page.hover('#fresh');
  await page.keyboard.press('ControlRight');
  await check('觸發式翻譯：在原文下方插入譯文', async () => {
    await page.waitForSelector('.immersive-translation-container', { timeout: 3000 });
    assert.equal(await page.textContent('.immersive-translation-container'), '[譯]Jumps over the lazy dog');
    assert.equal(await page.textContent('#fresh'), 'Jumps over the lazy dog');
  });
  await check('觸發式翻譯：單段用純文字模式', async () => {
    assert.equal(llmRequests.length, before + 1);
    assert.equal(llmRequests.at(-1).response_format, undefined);
  });

  // 5. 同樣的段落第二次應該吃快取
  await page.keyboard.press('ControlRight');  // 再按一次會收起
  await page.waitForTimeout(200);
  await page.keyboard.press('ControlRight');
  await page.waitForTimeout(500);
  await check('快取：同一段第二次不再打 API', async () => {
    assert.equal(llmRequests.length, before + 1);
  });

  // 6. 錯誤提示
  llmMode = 'unauthorized';
  await page.hover('#fresh2');
  await page.keyboard.press('ControlRight');
  await check('錯誤：401 會跳出金鑰錯誤的提示', async () => {
    await page.waitForSelector('#coco-error-toast', { state: 'visible', timeout: 3000 });
    const text = await page.textContent('#coco-error-toast');
    assert.match(text, /API 金鑰錯誤/);
    assert.match(text, /401/);
  });
  await check('錯誤：失敗時不插入一份跟原文一樣的「譯文」', async () => {
    assert.equal(await page.locator('.immersive-translation-container').count(), 1);
  });
  llmMode = 'ok';

  // 7. 輸入框翻譯
  await page.click('#floating-translate-btn');
  await page.fill('#input-box', '你好');
  await page.click('#translate-btn');
  await check('輸入框翻譯：用輸入目標語言翻譯', async () => {
    await page.waitForFunction(() => document.querySelector('#translation-box-content').textContent.startsWith('[譯]'), null, { timeout: 3000 });
    assert.equal(await page.textContent('#translation-box-content'), '[譯]你好');
    assert.match(llmRequests.at(-1).messages[0].content, /English/);
  });

  // 7-1. 快捷鍵
  await check('快捷鍵：翻譯整頁 ⇄ 還原', async () => {
    const toggle = () => sw.evaluate(async id => commandHandlers['toggle-page-translation'](await chrome.tabs.get(id)), tabId);
    await page.bringToFront();
    await page.evaluate(() => window.scrollTo(0, 0));   // 只翻畫面附近，先捲回頂端
    await toggle();
    await page.waitForFunction(() => document.querySelector('#p2').textContent === '[譯]The quick brown fox', null, { timeout: 3000 });
    await toggle();
    await page.waitForFunction(() => document.querySelector('#p2').textContent === 'The quick brown fox', null, { timeout: 3000 });
  });

  // 7-2. 設定頁：網站清單
  const options = await context.newPage();
  options.on('pageerror', err => errors.push('options pageerror: ' + err.message));
  await options.goto(`chrome-extension://${extId}/options.html#sites`);
  await options.fill('#siteInput', ' 127.0.0.1/some/page ');
  await options.click('#addSiteBtn');
  await check('設定頁：新增網站時自動整理格式', async () => {
    await options.waitForFunction(() => document.querySelectorAll('#siteList li').length === 1, null, { timeout: 3000 });
    assert.equal(await options.textContent('#siteList li code'), '127.0.0.1');
  });
  const autoPage = await context.newPage();
  await autoPage.goto(origin);
  await check('設定頁：網域規則會自動整頁翻譯', async () => {
    await autoPage.waitForFunction(() => document.querySelector('#p2').textContent === '[譯]The quick brown fox', null, { timeout: 5000 });
  });
  await autoPage.close();
  await options.click('#siteList li button');
  await check('設定頁：刪除網站', async () => {
    await options.waitForFunction(() => document.querySelectorAll('#siteList li').length === 0, null, { timeout: 3000 });
    const { siteTranslationList } = await sw.evaluate(() => chrome.storage.local.get('siteTranslationList'));
    assert.deepEqual(siteTranslationList, []);
  });
  // 7-2-1. 設定頁：術語表
  await options.goto(`chrome-extension://${extId}/options.html#glossary`);
  await options.fill('#glossarySource', 'fox');
  await options.fill('#glossaryTarget', '狐狸');
  await options.click('#addGlossaryBtn');
  await check('設定頁：新增術語表詞條', async () => {
    await options.waitForFunction(() => document.querySelectorAll('#glossaryList li').length === 1, null, { timeout: 3000 });
    assert.match(await options.textContent('#glossaryList li'), /fox → 狐狸/);
  });
  await page.bringToFront();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'glossary-p';
    p.textContent = 'A clever fox appeared';
    document.body.prepend(p);
    window.scrollTo(0, 0);
  });
  const beforeGlossary = llmRequests.length;
  await page.hover('#glossary-p');
  await page.keyboard.press('ControlRight');
  await check('術語表：翻譯時把用到的詞條交給 AI', async () => {
    await page.waitForFunction(() => document.querySelector('#glossary-p + .immersive-translation-container'), null, { timeout: 3000 });
    const request = llmRequests.slice(beforeGlossary).find(r => r.messages[1].content.includes('clever fox'));
    assert.ok(request, '應該有送出請求');
    assert.match(request.messages[0].content, /- fox → 狐狸/);
  });
  await options.bringToFront();
  await options.click('#glossaryList li button');
  await check('設定頁：刪除術語表詞條', async () => {
    await options.waitForFunction(() => document.querySelectorAll('#glossaryList li').length === 0, null, { timeout: 3000 });
  });
  await options.close();

  // 7-3. popup 勾選框認得萬用字元規則
  await sw.evaluate(() => chrome.storage.local.set({ siteTranslationList: ['*.0.0.1'] }));
  const sitePopup = await context.newPage();
  await sitePopup.addInitScript(([id, o]) => {
    const realQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q, cb) => q.active ? cb([{ id, url: o + '/' }]) : realQuery(q, cb);
  }, [tabId, origin]);
  await sitePopup.goto(`chrome-extension://${extId}/popup.html`);
  await sitePopup.waitForTimeout(400);
  await check('popup：萬用字元規則套用的網站會打勾', async () => {
    assert.equal(await sitePopup.isChecked('#alwaysTranslateCheckbox'), true);
  });
  await sitePopup.click('#alwaysTranslateCheckbox');
  await sitePopup.waitForTimeout(300);
  await check('popup：取消勾選萬用字元規則時，提示到設定頁修改', async () => {
    assert.match(await sitePopup.textContent('#custom-warning-modal p'), /\*\.0\.0\.1/);
    assert.equal(await sitePopup.isChecked('#alwaysTranslateCheckbox'), true);
    const { siteTranslationList } = await sw.evaluate(() => chrome.storage.local.get('siteTranslationList'));
    assert.deepEqual(siteTranslationList, ['*.0.0.1']);
  });
  await sitePopup.close();
  await sw.evaluate(() => chrome.storage.local.set({ siteTranslationList: [] }));

  // 8. popup：AI 設定與模型清單
  const popup = await context.newPage();
  popup.on('pageerror', err => errors.push('popup pageerror: ' + err.message));
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.click('#tabAPI');
  await check('popup：讀出已存的 AI 設定', async () => {
    assert.equal(await popup.inputValue('#llmProvider'), 'ollama-local');
    assert.equal(await popup.inputValue('#llmBaseUrl'), llmBaseUrl);
    assert.equal(await popup.inputValue('#llmModel'), 'mock');
  });
  await popup.click('#fetchLlmModelsBtn');
  await check('popup：載入模型清單', async () => {
    await popup.waitForFunction(() => document.querySelectorAll('#llmModelList option').length === 2, null, { timeout: 3000 });
    const models = await popup.$$eval('#llmModelList option', options => options.map(o => o.value));
    assert.deepEqual(models, ['mock-small:free', 'mock-large']);
  });
  await popup.selectOption('#llmProvider', 'openrouter');
  await popup.fill('#llmApiKey', 'sk-or-test');
  await popup.fill('#llmModel', 'google/gemma-4-31b-it:free');
  await popup.click('#saveLlmBtn');
  await popup.waitForTimeout(300);
  await popup.click('#custom-warning-modal button');
  await check('popup：切換供應商並儲存，其他供應商的設定不會被洗掉', async () => {
    const { llmSettings } = await sw.evaluate(() => chrome.storage.local.get('llmSettings'));
    assert.equal(llmSettings.provider, 'openrouter');
    assert.deepEqual(llmSettings.providers.openrouter, { apiKey: 'sk-or-test', model: 'google/gemma-4-31b-it:free', baseUrl: '' });
    assert.equal(llmSettings.providers['ollama-local'].baseUrl, llmBaseUrl);
  });
  await check('popup：翻譯來源選單有 AI (LLM)', async () => {
    await popup.click('#tabGeneral');
    await popup.click('#openApiModalBtn');
    const options = await popup.$$eval('#pageApiSelect option', os => os.map(o => o.value));
    assert.ok(options.includes('llm'));
    assert.equal(await popup.inputValue('#triggerApiSelect'), 'llm');
  });
  await check('popup：顯示目前的快捷鍵', async () => {
    assert.equal(await popup.textContent('#shortcutDisplay'), 'Alt+Shift+Y');
  });
  await check('popup：快取大小可以讀到', async () => {
    await popup.waitForFunction(() => /Cache Size: \d/.test(document.querySelector('#cacheSizeDisplay').textContent), null, { timeout: 3000 });
  });

  await check('沒有任何頁面錯誤', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  console.log(results.join('\n'));
  await context.close();
  llmServer.close();
  pageServer.close();
}

if (results.some(r => r.startsWith('✘'))) process.exit(1);
