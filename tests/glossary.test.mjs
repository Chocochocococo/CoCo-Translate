import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, jsonResponse, chatResponse } from './helpers/loadBackground.mjs';

const plain = value => JSON.parse(JSON.stringify(value));
const ENTRIES = [
  { source: 'Lin', target: '林', site: '' },
  { source: 'Lin Feng', target: '林楓', site: '' },
  { source: 'Azure Sect', target: '青雲宗', site: '*.novel.test' }
];

test('Glossary.active: 依網站篩選詞條', () => {
  const { context } = loadBackground();
  const pick = url => plain(context.Glossary.active(ENTRIES, url)).map(e => e.target);
  assert.deepEqual(pick('https://www.novel.test/1'), ['林', '林楓', '青雲宗']);
  assert.deepEqual(pick('https://other.site/'), ['林', '林楓']);
  assert.deepEqual(pick(''), ['林', '林楓']);
});

test('Glossary.used: 長的優先，不誤判 Linda', () => {
  const { context } = loadBackground();
  const used = texts => plain(context.Glossary.used(ENTRIES, texts)).map(e => e.source);
  assert.deepEqual(used(['Lin Feng smiled.']), ['Lin Feng']);
  assert.deepEqual(used(['Linda smiled.']), []);
  assert.deepEqual(used(['Lin and Lin Feng met at the Azure Sect.']), ['Lin', 'Lin Feng', 'Azure Sect']);
});

test('Glossary.wrapTerms: 只改文字部分，不動標籤和屬性', () => {
  const { context } = loadBackground();
  const html = '<b id="g0">Lin Feng</b> met <a id="g1" title="Lin Feng">Lin</a> &amp; Lindsay';
  const wrapped = context.Glossary.wrapTerms(html, ENTRIES);
  assert.equal(wrapped,
    '<b id="g0"><span class="notranslate" translate="no" id="t0">林楓</span></b> met ' +
    '<a id="g1" title="Lin Feng"><span class="notranslate" translate="no" id="t1">林</span></a> &amp; Lindsay');
  assert.equal(context.Glossary.unwrapTerms(wrapped), '<b id="g0">林楓</b> met <a id="g1" title="Lin Feng">林</a> &amp; Lindsay');
});

test('Glossary.signature: 內容一樣順序不同，指紋一樣；改了就不一樣', () => {
  const { context } = loadBackground();
  const { signature } = context.Glossary;
  assert.equal(signature([]), '');
  assert.equal(signature([ENTRIES[0], ENTRIES[1]]), signature([ENTRIES[1], ENTRIES[0]]));
  assert.notEqual(signature([ENTRIES[1]]), signature([{ ...ENTRIES[1], target: '林峰' }]));
});

test('TranslationService: 傳統翻譯先換成譯名、標成不翻譯，回來拿掉標記', async () => {
  const { context, fetchCalls } = loadBackground({
    storage: { glossary: ENTRIES },
    fetch: async (url, init) => {
      if (url.includes('translate_http')) return new Response('');
      const texts = JSON.parse(init.body)[0][0];
      return jsonResponse([texts.map(t => `譯:${t}`)]);
    }
  });
  const result = plain(await context.TranslationService.translate({
    role: 'page', texts: ['Lin Feng & Linda', 'No names here'], targetLang: 'zh-TW', pageUrl: 'https://a.b/'
  }));
  assert.deepEqual(result.translations, ['譯:林楓 & Linda', '譯:No names here']);
  const sent = JSON.parse(fetchCalls.find(c => c.url.includes('translateHtml')).init.body)[0][0];
  assert.equal(sent[0], '<span class="notranslate" translate="no" id="t0">林楓</span> &amp; Linda');
});

test('TranslationService: AI 翻譯只把用到的詞條寫進 prompt', async () => {
  const { context, fetchCalls } = loadBackground({
    storage: {
      glossary: ENTRIES,
      triggerTranslationSource: 'llm',
      llmSettings: { provider: 'ollama-local', providers: { 'ollama-local': { model: 'm' } } }
    },
    fetch: async () => chatResponse('林楓笑了')
  });
  await context.TranslationService.translate({ texts: ['Lin Feng smiled.'], targetLang: 'zh-TW', pageUrl: 'https://other.site/' });
  const system = JSON.parse(fetchCalls[0].init.body).messages[0].content;
  assert.match(system, /Glossary/);
  assert.match(system, /- Lin Feng → 林楓/);
  assert.doesNotMatch(system, /青雲宗/, '不是這個網站的詞條');
  assert.doesNotMatch(system, /- Lin → 林\n|- Lin → 林$/, '沒出現的詞條不用寫');
});

test('TranslationService: 術語表改了，快取自動換一份', async () => {
  let calls = 0;
  const { context, chrome } = loadBackground({
    storage: { glossary: [ENTRIES[1]] },
    fetch: async (url, init) => {
      if (url.includes('translate_http')) return new Response('');
      calls++;
      return jsonResponse([JSON.parse(init.body)[0][0]]);
    }
  });
  const run = () => context.TranslationService.translate({ texts: ['Lin Feng'], targetLang: 'zh-TW' });
  assert.deepEqual(plain((await run()).translations), ['林楓']);
  await run();
  assert.equal(calls, 1, '同一份術語表吃快取');
  chrome.storage.local.set({ glossary: [{ ...ENTRIES[1], target: '林峰' }] });
  assert.deepEqual(plain((await run()).translations), ['林峰']);
  assert.equal(calls, 2);
});
