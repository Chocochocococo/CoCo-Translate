import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, jsonResponse, chatResponse } from './helpers/loadBackground.mjs';

const plain = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- Markup.parse
test('Markup.parse: 解析帶 id 的標籤、解碼文字、<br> 變換行', () => {
  const { context } = loadBackground();
  const tree = context.Markup.parse('他對<i id="g1">她</i>說<b id="g0">你好 &amp; 再見</b><br><img id="x2"/>。');
  assert.deepEqual(plain(tree.children), [
    { type: 'text', text: '他對' },
    { type: 'el', id: 'g1', children: [{ type: 'text', text: '她' }] },
    { type: 'text', text: '說' },
    { type: 'el', id: 'g0', children: [{ type: 'text', text: '你好 & 再見' }] },
    { type: 'text', text: '\n' },
    { type: 'el', id: 'x2', children: [] },
    { type: 'text', text: '。' }
  ]);
});

test('Markup.parse: 巢狀、屬性順序不同、單引號都能解析', () => {
  const { context } = loadBackground();
  const tree = context.Markup.parse(`<b class='x' id='g0'>第<i id="g1">一</i>章</b>`);
  assert.equal(tree.children[0].id, 'g0');
  assert.equal(tree.children[0].children[1].id, 'g1');
});

test('Markup.parse: 標籤沒關、交錯、沒有 id 都回傳 null', () => {
  const { context } = loadBackground();
  assert.equal(context.Markup.parse('<b id="g0">沒關'), null);
  assert.equal(context.Markup.parse('<b id="g0"><i id="g1">交錯</b></i>'), null);
  assert.equal(context.Markup.parse('<span class="added">翻譯服務自己加的</span>'), null);
  assert.equal(context.Markup.parse('</b>'), null);
});

// ---------------------------------------------------------------- Markup.matchesStructure
test('Markup.matchesStructure: 順序可以換，父子關係、數量不能變', () => {
  const { context } = loadBackground();
  const { parse, matchesStructure } = context.Markup;
  const parents = { g0: null, g1: null, g2: 'g1', x3: null };
  assert.equal(matchesStructure(parse('<i id="g1">第<b id="g2">一</b></i>章<b id="g0">讀</b><img id="x3">'), parents), true);
  assert.equal(matchesStructure(parse('<i id="g1">第</i><b id="g2">一</b><b id="g0">讀</b><img id="x3">'), parents), false, 'g2 跑出 g1 了');
  assert.equal(matchesStructure(parse('<i id="g1">第<b id="g2">一</b></i><img id="x3">'), parents), false, 'g0 不見了');
  assert.equal(matchesStructure(parse('<b id="g0">a</b><b id="g0">b</b><i id="g1"><b id="g2">c</b></i><img id="x3">'), parents), false, 'g0 重複');
  assert.equal(matchesStructure(parse('<b id="g0">a</b><i id="g1"><b id="g2">c</b></i><img id="x3">多的</img>'), parents), true, 'img 是 void，後面的字算在外面');
  assert.equal(matchesStructure(null, parents), false);
});

// ---------------------------------------------------------------- protect / restore
test('Markup.protect/restore: 後處理只動文字，標籤原封不動', async () => {
  const { context } = loadBackground({
    storage: { regexPatterns: [{ input: 'id', output: 'ID', enabled: true }] }
  });
  const html = '他說“<b id="g0">你好 &amp; 再見</b>”，id 很重要 &lt;3';
  const [result] = await context.PostProcess.apply([html], 'zh-TW', { html: true });
  assert.equal(result, '他說「<b id="g0">你好 &amp; 再見</b>」，ID 很重要 &lt;3');
});

// ---------------------------------------------------------------- 各來源的 HTML 模式
test('GoogleTranslator: HTML 模式不再跳脫、換行變 <br> 再換回來', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async url => {
      if (url.includes('translate_http')) return new Response('');
      return jsonResponse([['他對<i id="g1">她</i>說<b id="g0">你好</b>', '第一行<br>第二行']]);
    }
  });
  const translator = new context.GoogleTranslator();
  const result = await translator.translateBatch(
    ['He said <b id="g0">hi</b> to <i id="g1">her</i>', 'Line one\nLine two'], 'zh-TW', 'auto', { html: true });
  assert.deepEqual(plain(result), ['他對<i id="g1">她</i>說<b id="g0">你好</b>', '第一行\n第二行']);
  const body = JSON.parse(fetchCalls.find(c => c.url.includes('translateHtml')).init.body);
  assert.deepEqual(body[0][0], ['He said <b id="g0">hi</b> to <i id="g1">her</i>', 'Line one<br>Line two']);
});

test('GoogleTranslator: 純文字模式也保留換行', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async url => url.includes('translate_http') ? new Response('') : jsonResponse([['第一行<br>第二行']])
  });
  const translator = new context.GoogleTranslator();
  assert.deepEqual(plain(await translator.translateBatch(['First\nSecond'], 'zh-TW')), ['第一行\n第二行']);
  const body = JSON.parse(fetchCalls.find(c => c.url.includes('translateHtml')).init.body);
  assert.deepEqual(body[0][0], ['First<br>Second']);
});

test('Bing / DeepL / Cloud: HTML 模式帶上各自的參數', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async (url, init) => {
      if (url.includes('translate/auth')) return new Response('token');
      if (url.includes('microsofttranslator')) return jsonResponse([{ translations: [{ text: '<b id="g0">你好</b>' }] }]);
      if (url.includes('deepl')) return jsonResponse({ translations: [{ text: '<b id="g0">你好</b>' }] });
      return jsonResponse({ data: { translations: [{ translatedText: '<b id="g0">你好</b>' }] } });
    }
  });
  const text = ['<b id="g0">Hello</b>'];
  await new context.BingTranslator().translateBatch(text, 'zh-TW', 'auto', { html: true });
  await new context.DeepLTranslator('k:fx').translateBatch(text, 'zh-TW', 'auto', { html: true });
  await new context.GoogleApiKeyTranslator('k').translateBatch(text, 'zh-TW', 'auto', { html: true });
  assert.ok(fetchCalls.some(c => c.url.includes('microsofttranslator') && c.url.includes('textType=html')));
  assert.equal(JSON.parse(fetchCalls.find(c => c.url.includes('deepl')).init.body).tag_handling, 'html');
  assert.equal(JSON.parse(fetchCalls.find(c => c.url.includes('translation.googleapis')).init.body).format, 'html');
});

test('OpenAICompatibleTranslator: HTML 模式在 prompt 裡交代保留標籤', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async () => chatResponse('{"segments":["<b id=\\"g0\\">你好</b>","世界"]}')
  });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'ollama-local', model: 'm' });
  const result = await translator.translateBatch(['<b id="g0">Hello</b>', 'World'], 'zh-TW', 'auto', { html: true });
  assert.deepEqual(plain(result), ['<b id="g0">你好</b>', '世界']);
  assert.match(JSON.parse(fetchCalls[0].init.body).messages[0].content, /Keep every tag with its id exactly once/);
});

test('TranslationService: HTML 與純文字的快取分開，純標籤也不送', async () => {
  let calls = 0;
  const { context } = loadBackground({
    storage: { triggerTranslationSource: 'deepl-api', deepLApiKey: 'k:fx' },
    fetch: async (url, init) => {
      calls++;
      const body = JSON.parse(init.body);
      return jsonResponse({ translations: body.text.map(t => ({ text: body.tag_handling ? `[H]${t}` : `[T]${t}` })) });
    }
  });
  const service = context.TranslationService;
  const html = plain(await service.translate({ texts: ['Hello', '<img id="x0">'], targetLang: 'zh-TW', format: 'html' }));
  const text = plain(await service.translate({ texts: ['Hello'], targetLang: 'zh-TW' }));
  assert.deepEqual(html.translations, ['[H]Hello', '<img id="x0">']);
  assert.deepEqual(text.translations, ['[T]Hello']);
  assert.equal(calls, 2);
});
