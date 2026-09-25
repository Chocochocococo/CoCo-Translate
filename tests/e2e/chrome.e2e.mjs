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
// 讓 context.route 也攔得到擴充功能 service worker 送出的請求（字典用假的資料）
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';
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

  // 7-4. 選取工具列、單字卡、生字本
  await page.bringToFront();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'vocab-p';
    p.textContent = 'Books are full of serendipity. Read more.';
    document.body.prepend(p);
    window.scrollTo(0, 0);
  });
  const wordBox = await page.evaluate(() => {
    const node = document.querySelector('#vocab-p').firstChild;
    const start = node.textContent.indexOf('serendipity');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'serendipity'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(wordBox.x, wordBox.y);
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
  await check('選取工具列：翻譯、查字典、朗讀三個按鈕', async () => {
    await page.waitForSelector('#coco-selection-toolbar', { state: 'visible', timeout: 3000 });
    const actions = await page.$$eval('#coco-selection-toolbar button', bs => bs.filter(b => b.style.display !== 'none').map(b => b.dataset.action));
    assert.deepEqual(actions, ['translate', 'lookup', 'speak']);
  });
  // 假的字典資料：Google 雙語詞典＋Free Dictionary 英英解釋
  await context.route('https://translate.googleapis.com/translate_a/single**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      sentences: [{ trans: '意外發現', orig: 'serendipity' }],
      dict: [{ pos: '名詞', terms: ['意外發現', '機緣巧合'], entry: [{ word: '意外發現' }, { word: '機緣巧合' }, { word: '偶然發現珍寶的運氣' }] }],
      src: 'en'
    })
  }));
  await context.route('https://api.dictionaryapi.dev/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ word: 'serendipity', phonetic: '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', meanings: [{ partOfSpeech: 'noun', definitions: [
      { definition: 'An unsought, unintended, and unexpected, but fortunate, discovery.', example: 'It was pure serendipity.' },
      { definition: 'The faculty of making such discoveries.' }
    ] }] }])
  }));
  await page.click('#coco-selection-toolbar button[data-action="speak"]');
  await page.click('#coco-selection-toolbar button[data-action="lookup"]');
  await check('單字卡：顯示譯文與例句', async () => {
    await page.waitForFunction(() => document.querySelector('#coco-word-card .coco-word-translation')?.textContent === '[譯]serendipity', null, { timeout: 3000 });
    assert.match(await page.textContent('#coco-word-card'), /Books are full of serendipity\./);
  });
  await check('單字卡：字典依詞性列出多個意思，英英解釋有多條和例句', async () => {
    await page.waitForSelector('#coco-word-card .coco-dict-sense', { timeout: 3000 });
    assert.equal(await page.textContent('#coco-word-card .coco-dict-sense'), '名詞意外發現、機緣巧合、偶然發現珍寶的運氣');
    assert.equal(await page.textContent('#coco-word-card .coco-phonetic'), '/ˌsɛɹ.ənˈdɪp.ɪ.ti/');
    assert.equal(await page.locator('#coco-word-card .coco-dict-definition li').count(), 2);
    assert.match(await page.textContent('#coco-word-card .coco-dict-definition'), /名詞.*unexpected, but fortunate.*“It was pure serendipity\.”/s);
  });
  await page.click('#coco-word-card .coco-save-word');
  await check('單字卡：加入生字本', async () => {
    await page.waitForFunction(() => document.querySelector('#coco-word-card .coco-save-word').disabled, null, { timeout: 3000 });
    const { vocabulary } = await sw.evaluate(() => chrome.storage.local.get('vocabulary'));
    assert.equal(vocabulary.length, 1);
    assert.equal(vocabulary[0].word, 'serendipity');
    assert.equal(vocabulary[0].translation, '[譯]serendipity');
    assert.equal(vocabulary[0].context, 'Books are full of serendipity.');
    assert.equal(vocabulary[0].meanings, '名詞 意外發現、機緣巧合、偶然發現珍寶的運氣');
  });
  // 外觀：網頁裡的工具列、單字卡跟 popup 同一個設定
  const cocoColors = () => page.evaluate(() => ({
    card: getComputedStyle(document.querySelector('#coco-word-card')).backgroundColor,
    text: getComputedStyle(document.querySelector('#coco-word-card')).color,
    toolbar: getComputedStyle(document.querySelector('#coco-selection-toolbar')).backgroundColor
  }));
  await check('外觀：工具列、單字卡預設淺色', async () => {
    const colors = await cocoColors();
    assert.equal(colors.card, 'rgb(255, 255, 255)');
    assert.equal(colors.toolbar, 'rgb(255, 255, 255)');
  });
  await sw.evaluate(() => chrome.storage.local.set({ uiTheme: 'dark' }));
  await check('外觀：切成深色，開著的單字卡、工具列馬上跟著變', async () => {
    await page.waitForFunction(() => document.querySelector('#coco-word-card').dataset.cocoTheme === 'dark', null, { timeout: 3000 });
    assert.deepEqual(await cocoColors(), { card: 'rgb(33, 39, 36)', text: 'rgb(230, 236, 232)', toolbar: 'rgb(33, 39, 36)' });
  });
  await sw.evaluate(() => chrome.storage.local.set({ uiTheme: 'auto' }));
  await page.emulateMedia({ colorScheme: 'dark' });
  await check('外觀：自動模式跟著系統的深色設定', async () => {
    await page.waitForFunction(() => document.querySelector('#coco-word-card').dataset.cocoTheme === 'dark', null, { timeout: 3000 });
    assert.equal((await cocoColors()).card, 'rgb(33, 39, 36)');
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await check('外觀：系統切回淺色，自動模式也切回來', async () => {
    await page.waitForFunction(() => document.querySelector('#coco-word-card').dataset.cocoTheme === 'light', null, { timeout: 3000 });
    assert.equal((await cocoColors()).card, 'rgb(255, 255, 255)');
  });
  await page.keyboard.press('Escape');
  await check('單字卡：按 Esc 關閉', async () => {
    assert.equal(await page.locator('#coco-word-card').count(), 0);
  });
  const vocabPage = await context.newPage();
  vocabPage.on('pageerror', err => errors.push('options pageerror: ' + err.message));
  await vocabPage.goto(`chrome-extension://${extId}/options.html#vocabulary`);
  await check('生字本：設定頁列出收藏的字', async () => {
    await vocabPage.waitForFunction(() => document.querySelectorAll('#vocabularyList li').length === 1, null, { timeout: 3000 });
    assert.match(await vocabPage.textContent('#vocabularyList li'), /serendipity/);
  });
  const [download] = await Promise.all([vocabPage.waitForEvent('download'), vocabPage.click('#exportAnkiBtn')]);
  await check('生字本：匯出 Anki 格式', async () => {
    const content = fs.readFileSync(await download.path(), 'utf8');
    const lines = content.trim().split('\n');
    assert.equal(lines[0], '#separator:tab');
    assert.equal(lines[2], '#columns:Word\tTranslation\tPhonetic\tContext\tSource\tMeanings');
    const fields = lines[3].split('\t');
    assert.deepEqual(fields.slice(0, 4), ['serendipity', '[譯]serendipity', '/ˌsɛɹ.ənˈdɪp.ɪ.ti/', 'Books are full of serendipity.']);
    assert.equal(fields[5], '名詞 意外發現、機緣巧合、偶然發現珍寶的運氣');
  });
  await vocabPage.close();
  await sw.evaluate(() => chrome.storage.local.set({ vocabulary: [] }));

  // 7-5. YouTube 雙語字幕（假的 YouTube 播放器，結構跟真的一樣）
  await context.route('https://www.youtube.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body>
      <div id="movie_player" class="html5-video-player" style="position:relative;width:640px;height:360px;background:#000">
        <div class="ytp-caption-window-container">
          <!-- YouTube 會留下用過、藏起來的字幕框 -->
          <div class="caption-window ytp-caption-window-top" style="display:none">
            <span class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment">So, one of Musk's Doge Bros</span></span></span>
          </div>
          <div class="caption-window ytp-caption-window-bottom" style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%)">
            <span class="captions-text"></span>
          </div>
        </div>
        <button class="ytp-subtitles-button" aria-pressed="true">CC</button>
      </div>
      <script>
        // 真的 YouTube 點播放器會暫停、按兩下會全螢幕：數一下有沒有點擊漏到播放器
        window.playerClicks = 0;
        document.getElementById('movie_player').addEventListener('click', () => window.playerClicks++);
        document.getElementById('movie_player').addEventListener('dblclick', () => window.playerClicks++);
      </script></body></html>`
  }));
  const yt = await context.newPage();
  yt.on('pageerror', err => errors.push('youtube pageerror: ' + err.message));
  await yt.goto('https://www.youtube.com/watch?v=test');
  const setCaptions = lines => yt.evaluate(lines => {
    document.querySelector('.ytp-caption-window-bottom .captions-text').innerHTML = lines
      .map(line => `<span class="caption-visual-line"><span class="ytp-caption-segment" style="font-size:20px">${line}</span></span>`)
      .join('');
  }, lines);
  await yt.waitForTimeout(500);
  await setCaptions(['Hello everyone']);
  await yt.waitForTimeout(1000);
  await check('YouTube 字幕：預設關閉', async () => {
    assert.equal(await yt.locator('#coco-yt-subtitle').count(), 0);
  });
  await sw.evaluate(() => chrome.storage.local.set({ enableYouTubeSubtitles: true }));
  await check('YouTube 字幕：原本的 CC 變透明，換成一個字幕框（原文＋譯文）', async () => {
    await yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle .coco-yt-translated')?.textContent === '[譯]Hello everyone', null, { timeout: 3000 });
    assert.equal(await yt.textContent('#coco-yt-subtitle .coco-yt-original'), 'Hello everyone');
    assert.equal(await yt.evaluate(() => getComputedStyle(document.querySelector('.ytp-caption-window-container')).opacity), '0');
    assert.equal(await yt.evaluate(() => getComputedStyle(document.querySelector('#coco-yt-subtitle')).fontSize), '20px');
  });
  await check('YouTube 字幕：不讀 YouTube 藏起來的舊字幕框', async () => {
    assert.doesNotMatch(await yt.textContent('#coco-yt-subtitle'), /Doge/);
  });
  await check('YouTube 字幕：字幕框放在原本 CC 的位置，拖曳 CC 會跟著移動', async () => {
    const aligned = () => yt.evaluate(() => {
      const box = document.querySelector('#coco-yt-subtitle').getBoundingClientRect();
      const caption = document.querySelector('.ytp-caption-window-bottom').getBoundingClientRect();
      return Math.abs(box.bottom - caption.bottom) < 2 && Math.abs((box.left + box.right) / 2 - (caption.left + caption.right) / 2) < 2;
    });
    assert.ok(await aligned(), '字幕框要對齊原本 CC 的位置');
    await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.bottom = '200px'; });   // 模擬使用者把 CC 拖上去
    await yt.waitForTimeout(200);
    assert.ok(await aligned(), '拖曳後要跟著移動');
    await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.bottom = '20px'; });
  });
  await sw.evaluate(() => chrome.storage.local.set({ youTubeSubtitleScale: '1.5' }));
  await check('YouTube 字幕：字幕大小可以調整（原字幕 20px × 150%）', async () => {
    await yt.waitForFunction(() => getComputedStyle(document.querySelector('#coco-yt-subtitle')).fontSize === '30px', null, { timeout: 3000 });
  });
  await sw.evaluate(() => chrome.storage.local.set({ youTubeSubtitleScale: '1' }));
  await yt.waitForFunction(() => getComputedStyle(document.querySelector('#coco-yt-subtitle')).fontSize === '20px', null, { timeout: 3000 });

  const ytRects = () => yt.evaluate(() => {
    const box = document.querySelector('#coco-yt-subtitle').getBoundingClientRect();
    const caption = document.querySelector('.ytp-caption-window-bottom').getBoundingClientRect();
    return { box: { x: box.left + box.width / 2, y: box.top + box.height / 2, bottom: box.bottom }, captionBottom: caption.bottom };
  });
  const beforeDrag = await ytRects();
  await yt.mouse.move(beforeDrag.box.x, beforeDrag.box.y);
  await yt.mouse.down();
  await yt.mouse.move(beforeDrag.box.x + 40, beforeDrag.box.y - 100, { steps: 5 });
  await yt.mouse.up();
  await check('YouTube 字幕：字幕框可以直接用滑鼠拖曳，而且不會點到播放器', async () => {
    const after = await ytRects();
    assert.ok(Math.abs(after.box.bottom - (beforeDrag.box.bottom - 100)) < 2, `往上拖 100px，實際 ${beforeDrag.box.bottom - after.box.bottom}px`);
    assert.ok(Math.abs(after.box.x - (beforeDrag.box.x + 40)) < 2);
    assert.equal(await yt.evaluate(() => window.playerClicks), 0);
    await yt.waitForTimeout(200);
    const { youTubeSubtitlePosition } = await sw.evaluate(() => chrome.storage.local.get('youTubeSubtitlePosition'));
    assert.ok(youTubeSubtitlePosition && youTubeSubtitlePosition.bottom > 0, '拖過的位置要存起來');
  });
  await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.bottom = '60px'; });
  await check('YouTube 字幕：拖過之後就停在那裡，不再跟著原字幕跑', async () => {
    await yt.waitForTimeout(200);
    const now = await ytRects();
    assert.ok(Math.abs(now.box.bottom - (beforeDrag.box.bottom - 100)) < 2);
  });
  await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.bottom = '20px'; });
  const dragged = await ytRects();
  await yt.mouse.dblclick(dragged.box.x, dragged.box.y);
  await check('YouTube 字幕：按兩下回到原本 CC 的位置', async () => {
    await yt.waitForTimeout(300);
    const now = await ytRects();
    assert.ok(Math.abs(now.box.bottom - now.captionBottom) < 2);
    assert.equal(await yt.evaluate(() => window.playerClicks), 0);
    const { youTubeSubtitlePosition } = await sw.evaluate(() => chrome.storage.local.get('youTubeSubtitlePosition'));
    assert.equal(youTubeSubtitlePosition, undefined);
  });
  const beforeRolling = llmRequests.length;
  for (const partial of ['Today we', 'Today we will', 'Today we will learn', 'Today we will learn about', 'Today we will learn about foxes']) {
    await setCaptions(['Hello everyone', partial]);
    await yt.waitForTimeout(120);
  }
  await check('YouTube 字幕：逐字滾動時節流，而且翻過的行吃快取', async () => {
    await yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle .coco-yt-translated')?.textContent === '[譯]Hello everyone\n[譯]Today we will learn about foxes', null, { timeout: 3000 });
    const rollingRequests = llmRequests.slice(beforeRolling);
    assert.ok(rollingRequests.length <= 3, `滾動 5 次只該送出少數幾次請求，實際 ${rollingRequests.length} 次`);
    assert.ok(rollingRequests.every(r => !r.messages[1].content.includes('Hello everyone')), '第一行已經翻過，不該再送');
  });
  await sw.evaluate(() => chrome.storage.local.set({ youTubeSubtitleMode: 'translation' }));
  await check('YouTube 字幕：只顯示譯文模式', async () => {
    await yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle .coco-yt-original')?.style.display === 'none', null, { timeout: 3000 });
    assert.equal(await yt.textContent('#coco-yt-subtitle .coco-yt-translated'), '[譯]Hello everyone\n[譯]Today we will learn about foxes');
  });
  llmMode = 'unauthorized';
  await setCaptions(['This line fails to translate']);
  await check('YouTube 字幕：翻譯失敗不跳提示，只譯文模式改顯示原文', async () => {
    await yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle .coco-yt-translated')?.textContent === 'This line fails to translate', null, { timeout: 4000 });
    await yt.waitForTimeout(300);
    assert.equal(await yt.locator('#coco-error-toast').count(), 0);
  });
  llmMode = 'ok';
  await sw.evaluate(() => chrome.storage.local.set({ youTubeSubtitleMode: 'bilingual' }));
  await setCaptions([]);
  await check('YouTube 字幕：字幕消失時字幕框也隱藏', async () => {
    await yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle')?.style.display === 'none', null, { timeout: 3000 });
  });
  const boxShown = () => yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle')?.style.display === 'block', null, { timeout: 3000 });
  const boxHidden = () => yt.waitForFunction(() => document.querySelector('#coco-yt-subtitle')?.style.display === 'none', null, { timeout: 3000 });
  await setCaptions(['Still talking']);
  await boxShown();
  // YouTube 只改 style 把字幕藏起來（文字還在 DOM 裡）
  await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.display = 'none'; });
  await check('YouTube 字幕：原字幕只是被 style 藏起來，字幕框也跟著藏', async () => {
    await boxHidden();
  });
  await yt.evaluate(() => { document.querySelector('.ytp-caption-window-bottom').style.display = ''; });
  await check('YouTube 字幕：原字幕重新出現，字幕框也回來', async () => {
    await boxShown();
    assert.equal(await yt.textContent('#coco-yt-subtitle .coco-yt-original'), 'Still talking');
  });
  await yt.evaluate(() => document.querySelector('.ytp-subtitles-button').setAttribute('aria-pressed', 'false'));
  await check('YouTube 字幕：關掉 CC 按鈕，就算 DOM 裡還有字幕也不顯示', async () => {
    await boxHidden();
  });
  await yt.evaluate(() => document.querySelector('.ytp-subtitles-button').setAttribute('aria-pressed', 'true'));
  await boxShown();
  await sw.evaluate(() => chrome.storage.local.set({ enableYouTubeSubtitles: false }));
  await check('YouTube 字幕：關閉後移除字幕框，原本的 CC 恢復顯示', async () => {
    await yt.waitForFunction(() => !document.querySelector('#coco-yt-subtitle'), null, { timeout: 3000 });
    assert.equal(await yt.evaluate(() => getComputedStyle(document.querySelector('.ytp-caption-window-container')).opacity), '1');
  });
  await yt.close();

  // 8. 設定頁：翻譯來源與 AI
  const settings = await context.newPage();
  settings.on('pageerror', err => errors.push('options pageerror: ' + err.message));
  await settings.goto(`chrome-extension://${extId}/options.html#sources`);
  await settings.waitForTimeout(300);
  await check('設定頁：讀出已存的 AI 設定', async () => {
    assert.equal(await settings.inputValue('#llmProvider'), 'ollama-local');
    assert.equal(await settings.inputValue('#llmBaseUrl'), llmBaseUrl);
    assert.equal(await settings.inputValue('#llmModel'), 'mock');
  });
  await settings.click('#fetchLlmModelsBtn');
  await check('設定頁：載入模型清單', async () => {
    await settings.waitForFunction(() => document.querySelectorAll('#llmModelList option').length === 2, null, { timeout: 3000 });
    const models = await settings.$$eval('#llmModelList option', options => options.map(o => o.value));
    assert.deepEqual(models, ['mock-small:free', 'mock-large']);
  });
  await settings.selectOption('#llmProvider', 'openrouter');
  await settings.fill('#llmApiKey', 'sk-or-test');
  await settings.fill('#llmModel', 'google/gemma-4-31b-it:free');
  await settings.click('#saveLlmBtn');
  await settings.waitForTimeout(300);
  await settings.click('#custom-warning-modal button');
  await check('設定頁：切換供應商並儲存，其他供應商的設定不會被洗掉', async () => {
    const { llmSettings } = await sw.evaluate(() => chrome.storage.local.get('llmSettings'));
    assert.equal(llmSettings.provider, 'openrouter');
    assert.deepEqual(llmSettings.providers.openrouter, { apiKey: 'sk-or-test', model: 'google/gemma-4-31b-it:free', baseUrl: '' });
    assert.equal(llmSettings.providers['ollama-local'].baseUrl, llmBaseUrl);
  });
  await check('設定頁：整頁翻譯用雲端 AI 會提醒額度', async () => {
    await settings.waitForFunction(() => /額度/.test(document.querySelector('#sourceWarning').textContent), null, { timeout: 3000 });
  });
  await settings.selectOption('#llmProvider', 'gemini');
  await check('設定頁：Gemini 預設模型與申請說明', async () => {
    assert.equal(await settings.inputValue('#llmModel'), 'gemini-3.5-flash-lite');
    assert.match(await settings.textContent('#llmHint'), /aistudio\.google\.com/);
    const providers = await settings.$$eval('#llmProvider option', os => os.map(o => o.value));
    assert.deepEqual(providers, ['ollama-cloud', 'openrouter', 'gemini', 'groq', 'mistral', 'ollama-local', 'custom']);
  });
  await check('設定頁：翻譯來源選單有 AI 翻譯，而且讀得到已存的來源', async () => {
    const options = await settings.$$eval('#pageSource option', os => os.map(o => o.value));
    assert.ok(options.includes('llm'));
    assert.equal(await settings.inputValue('#triggerSource'), 'llm');
    assert.equal(await settings.inputValue('#pageSource'), 'llm');
  });
  await settings.selectOption('#triggerSource', 'bing');
  await check('設定頁：翻譯來源改了馬上存', async () => {
    await settings.waitForTimeout(200);
    const { triggerTranslationSource } = await sw.evaluate(() => chrome.storage.local.get('triggerTranslationSource'));
    assert.equal(triggerTranslationSource, 'bing');
  });
  await sw.evaluate(() => chrome.storage.local.set({ triggerTranslationSource: 'llm' }));

  // 9. 設定頁：一般
  await settings.goto(`chrome-extension://${extId}/options.html#general`);
  await settings.waitForTimeout(300);
  await check('設定頁：顯示目前的快捷鍵', async () => {
    assert.equal(await settings.textContent('#shortcutDisplay'), 'Alt+Shift+Y');
  });
  await check('設定頁：快取大小可以讀到', async () => {
    await settings.waitForFunction(() => /快取大小：\d/.test(document.querySelector('#cacheSizeDisplay').textContent), null, { timeout: 3000 });
  });
  await settings.click('#triggerKey');
  await settings.keyboard.press('ShiftRight');
  await check('設定頁：按一個鍵設定觸發鍵', async () => {
    await settings.waitForTimeout(200);
    const { triggerKey } = await sw.evaluate(() => chrome.storage.local.get('triggerKey'));
    assert.equal(triggerKey, 'ShiftRight');
    assert.equal(await settings.inputValue('#triggerKey'), 'Right Shift');
  });
  await sw.evaluate(() => chrome.storage.local.set({ triggerKey: 'ControlRight' }));
  await settings.click('#useDiskCache');
  await check('設定頁：開關改了馬上存', async () => {
    await settings.waitForTimeout(200);
    const { useDiskCache } = await sw.evaluate(() => chrome.storage.local.get('useDiskCache'));
    assert.equal(useDiskCache, true);
  });
  await settings.click('#useDiskCache');
  await settings.click('#themeSegmented button[data-value="dark"]');
  await check('外觀：設定頁手動切成深色', async () => {
    assert.equal(await settings.getAttribute('html', 'data-theme'), 'dark');
    const { uiTheme } = await sw.evaluate(() => chrome.storage.local.get('uiTheme'));
    assert.equal(uiTheme, 'dark');
    const background = await settings.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(background, 'rgb(23, 27, 25)');
  });
  await settings.selectOption('#languageSelector', 'en');
  await check('設定頁：切換介面語言', async () => {
    await settings.waitForFunction(() => document.querySelector('#navGeneral').textContent.includes('General'), null, { timeout: 3000 });
    assert.match(await settings.textContent('#cacheSizeDisplay'), /^Cache size: /);
  });
  await settings.selectOption('#languageSelector', 'zh');

  // 10. popup（AI 換回假伺服器，剛剛存的 OpenRouter 金鑰是假的，翻不了）
  await sw.evaluate(async () => {
    const { llmSettings } = await chrome.storage.local.get('llmSettings');
    await chrome.storage.local.set({ llmSettings: { ...llmSettings, provider: 'ollama-local' } });
  });
  const popup = await context.newPage();
  popup.on('pageerror', err => errors.push('popup pageerror: ' + err.message));
  await popup.addInitScript(([id, o]) => {
    const realQuery = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q, cb) => q.active ? cb([{ id, url: o + '/' }]) : realQuery(q, cb);
  }, [tabId, origin]);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(400);
  await check('popup：跟著設定頁的深色外觀', async () => {
    assert.equal(await popup.getAttribute('html', 'data-theme'), 'dark');
    assert.equal(await popup.getAttribute('#themeToggle', 'data-mode'), 'dark');
  });
  await popup.click('#themeToggle');
  await check('popup：外觀按鈕 深色 → 自動（跟隨系統）', async () => {
    assert.equal(await popup.getAttribute('html', 'data-theme'), null);
    const { uiTheme } = await sw.evaluate(() => chrome.storage.local.get('uiTheme'));
    assert.equal(uiTheme, 'auto');
    // 設定頁也同步
    await settings.waitForFunction(() => !document.documentElement.dataset.theme, null, { timeout: 3000 });
  });
  await check('popup：顯示網域、快捷鍵、目前的翻譯來源', async () => {
    assert.equal(await popup.textContent('#siteHost'), '127.0.0.1');
    assert.equal(await popup.textContent('#pageShortcut'), 'Alt+Shift+Y');
    assert.equal(await popup.inputValue('#pageSource'), 'llm');
    assert.match(await popup.textContent('#triggerHint'), /Right Ctrl/);
  });
  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  const translatedBefore = (await page.textContent('#p2')).startsWith('[譯]');
  await check('popup：大按鈕反映目前分頁的翻譯狀態', async () => {
    assert.equal(await popup.textContent('#pageToggleLabel'), translatedBefore ? '顯示原文' : '翻譯此頁');
  });
  await popup.click('#pageToggleBtn');
  await check('popup：按大按鈕翻譯 ⇄ 還原目前分頁', async () => {
    await page.waitForFunction(expected => document.querySelector('#p2').textContent.startsWith('[譯]') === expected,
      !translatedBefore, { timeout: 5000 });
    assert.equal(await popup.textContent('#pageToggleLabel'), translatedBefore ? '翻譯此頁' : '顯示原文');
  });
  await popup.click('#displayMode button[data-value="bilingual"]');
  await check('popup：切換顯示方式馬上存', async () => {
    const { pageDisplayMode } = await sw.evaluate(() => chrome.storage.local.get('pageDisplayMode'));
    assert.equal(pageDisplayMode, 'bilingual');
    assert.equal(await popup.getAttribute('#displayMode button[data-value="bilingual"]', 'aria-pressed'), 'true');
  });
  await popup.click('#displayMode button[data-value="replace"]');
  await popup.click('#toggleTranslation');
  await check('popup：關閉滑鼠觸發翻譯', async () => {
    await popup.waitForTimeout(200);
    const { isEnabled } = await sw.evaluate(() => chrome.storage.local.get('isEnabled'));
    assert.equal(isEnabled, false);
  });
  await popup.click('#toggleTranslation');

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
