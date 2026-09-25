import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackground, jsonResponse, chatResponse } from './helpers/loadBackground.mjs';

// vm 裡建立的陣列跟 Node 的原型不同，比較前先轉成一般物件
const plain = value => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- PostProcess
test('PostProcess: 引號轉成「」，英文與韓文不轉', async () => {
  const { context } = loadBackground();
  assert.equal(context.PostProcess.convertQuotes('他說“你好”', 'zh-TW'), '他說「你好」');
  assert.equal(context.PostProcess.convertQuotes('He said "hi"', 'en'), 'He said "hi"');
  assert.equal(context.PostProcess.convertQuotes('"안녕"', 'ko'), '"안녕"');
});

test('PostProcess: HTML 跳脫與解碼互為反向', () => {
  const { context } = loadBackground();
  const text = `a < b & c > d "quoted" it's`;
  const escaped = context.PostProcess.escapeHtml(text);
  assert.equal(escaped, 'a &lt; b &amp; c &gt; d "quoted" it\'s');
  assert.equal(context.PostProcess.decodeHtmlEntities(escaped), text);
  assert.equal(context.PostProcess.decodeHtmlEntities('It&#39;s &#x4F60;'), "It's 你");
});

test('PostProcess: 清掉 LLM 的思考過程與 Markdown 圍欄', () => {
  const { context } = loadBackground();
  const raw = '<think>let me think</think>\n```json\n{"segments":["好"]}\n```';
  assert.equal(context.PostProcess.cleanLLMOutput(raw), '{"segments":["好"]}');
});

test('PostProcess: 套用啟用中的自訂正規表達式，規則改了會重新讀取', async () => {
  const { context, chrome } = loadBackground({
    storage: { regexPatterns: [{ input: '貓', output: '喵', enabled: true }, { input: '狗', output: '汪', enabled: false }] }
  });
  assert.deepEqual(plain(await context.PostProcess.apply(['貓和狗'], 'zh-TW')), ['喵和狗']);
  chrome.storage.local.set({ enableCustomRegex: false });
  assert.deepEqual(plain(await context.PostProcess.apply(['貓和狗'], 'zh-TW')), ['貓和狗']);
});

// ---------------------------------------------------------------- RequestQueue
test('RequestQueue: concurrency 1 會一個一個跑', async () => {
  const { context } = loadBackground();
  const queue = new context.RequestQueue({ concurrency: 1 });
  let running = 0;
  let maxRunning = 0;
  const task = () => new Promise(resolve => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    setTimeout(() => { running--; resolve(); }, 10);
  });
  await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
  assert.equal(maxRunning, 1);
});

test('RequestQueue: rpm 會拉開請求間隔', async () => {
  const { context } = loadBackground();
  const queue = new context.RequestQueue({ concurrency: 5, rpm: 600 }); // 每 100ms 一個
  const starts = [];
  await Promise.all([1, 2, 3].map(() => queue.run(async () => starts.push(Date.now()))));
  assert.ok(starts[2] - starts[0] >= 190, `間隔太短：${starts[2] - starts[0]}ms`);
});

// ---------------------------------------------------------------- 傳統翻譯來源
test('GoogleTranslator: 批次送出、輸入先跳脫、回傳解碼', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async url => {
      if (url.includes('translate_http')) return new Response('', { status: 200 });
      return jsonResponse([['你好', 'a &lt; b'], ['en', 'en']]);
    }
  });
  const translator = new context.GoogleTranslator();
  const result = await translator.translateBatch(['Hello', 'a < b'], 'zh-TW');
  assert.deepEqual(plain(result), ['你好', 'a < b']);
  const call = fetchCalls.find(c => c.url.includes('translateHtml'));
  assert.deepEqual(JSON.parse(call.init.body), [[['Hello', 'a &lt; b'], 'auto', 'zh-TW'], 'te']);
  assert.equal(call.init.headers['Content-Type'], 'application/json+protobuf');
});

test('DeepLTranslator: 繁中用 ZH-HANT、:fx 金鑰走免費端點、金鑰放 header', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async () => jsonResponse({ translations: [{ text: '一' }, { text: '二' }] })
  });
  const translator = new context.DeepLTranslator('abc:fx', 'pro');
  assert.deepEqual(plain(await translator.translateBatch(['one', 'two'], 'zh-TW')), ['一', '二']);
  assert.equal(fetchCalls[0].url, 'https://api-free.deepl.com/v2/translate');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'DeepL-Auth-Key abc:fx');
  assert.equal(JSON.parse(fetchCalls[0].init.body).target_lang, 'ZH-HANT');
});

test('BingTranslator: 中文代碼轉 zh-Hant，token 過期會重拿一次', async () => {
  let translateCalls = 0;
  const { context, fetchCalls } = loadBackground({
    fetch: async url => {
      if (url.includes('translate/auth')) return new Response('token-' + fetchCalls.length);
      translateCalls++;
      if (translateCalls === 1) return new Response('expired', { status: 401 });
      return jsonResponse([{ translations: [{ text: '你好' }] }]);
    }
  });
  const translator = new context.BingTranslator();
  assert.deepEqual(plain(await translator.translateBatch(['Hello'], 'zh-TW')), ['你好']);
  assert.ok(fetchCalls.some(c => c.url.includes('to=zh-Hant')));
  assert.equal(fetchCalls.filter(c => c.url.includes('translate/auth')).length, 2);
});

// ---------------------------------------------------------------- AI 翻譯
test('parseSegmentsResponse: 接受物件、陣列、圍欄；數量不對回傳 null', () => {
  const { context } = loadBackground();
  const parse = context.parseSegmentsResponse;
  assert.deepEqual(plain(parse('{"segments":["一","二"]}', 2)), ['一', '二']);
  assert.deepEqual(plain(parse('```json\n["一","二"]\n```', 2)), ['一', '二']);
  assert.deepEqual(plain(parse('Sure! {"segments":["一","二"]} Hope this helps', 2)), ['一', '二']);
  assert.equal(parse('{"segments":["一"]}', 2), null);
  assert.equal(parse('not json', 2), null);
});

test('OpenAICompatibleTranslator: 多段用 JSON 一次翻完，帶 OpenRouter header', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async () => chatResponse('{"segments":["你好","世界"]}')
  });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'openrouter', apiKey: 'sk-or' });
  assert.deepEqual(plain(await translator.translateBatch(['Hello', 'World'], 'zh-TW')), ['你好', '世界']);
  assert.equal(fetchCalls.length, 1);
  const { url, init } = fetchCalls[0];
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer sk-or');
  assert.equal(init.headers['X-Title'], 'CoCo Translate');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'google/gemma-4-31b-it:free');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.deepEqual(JSON.parse(body.messages[1].content), { segments: ['Hello', 'World'] });
  assert.match(body.messages[0].content, /Taiwan Traditional Chinese/);
});

test('OpenAICompatibleTranslator: 單段用純文字模式', async () => {
  const { context, fetchCalls } = loadBackground({ fetch: async () => chatResponse('```\n你好\n```') });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'ollama-cloud', apiKey: 'k' });
  assert.deepEqual(plain(await translator.translateBatch(['Hello'], 'zh-TW')), ['你好']);
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.model, 'gemma4:31b');
  assert.equal(body.response_format, undefined);
  assert.equal(fetchCalls[0].url, 'https://ollama.com/v1/chat/completions');
});

test('OpenAICompatibleTranslator: 模型漏段時切半重試', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      const user = body.messages[1].content;
      if (body.response_format) {
        const { segments } = JSON.parse(user);
        // 6 段的時候故意漏一段，3 段就正常回
        const out = segments.map(s => `譯:${s}`);
        return chatResponse(JSON.stringify({ segments: segments.length > 3 ? out.slice(1) : out }));
      }
      return chatResponse('?');
    }
  });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'ollama-local', model: 'gemma3' });
  const texts = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(plain(await translator.translateBatch(texts, 'zh-TW')), texts.map(t => `譯:${t}`));
  assert.equal(fetchCalls.length, 3);
});

test('OpenAICompatibleTranslator: 缺金鑰、401、429 都丟出對應的錯誤代碼', async () => {
  const { context } = loadBackground({
    fetch: async (url, init) => init.headers.Authorization === 'Bearer bad'
      ? new Response('unauthorized', { status: 401 })
      : new Response('rate limited', { status: 429 })
  });
  const noKey = new context.OpenAICompatibleTranslator({ provider: 'openrouter' });
  await assert.rejects(noKey.translateBatch(['a', 'b'], 'zh-TW'), { code: 'config' });
  const badKey = new context.OpenAICompatibleTranslator({ provider: 'mistral', apiKey: 'bad' });
  await assert.rejects(badKey.translateBatch(['a'], 'zh-TW'), { code: 'auth' });
  const limited = new context.OpenAICompatibleTranslator({ provider: 'custom', baseUrl: 'https://x.test/v1', model: 'm' });
  await assert.rejects(limited.translateBatch(['a'], 'zh-TW'), { code: 'quota' });
});

test('OpenAICompatibleTranslator: 模型清單把 :free 排前面', async () => {
  const { context } = loadBackground({
    fetch: async () => jsonResponse({ data: [{ id: 'b/paid' }, { id: 'a/model:free' }, { id: 'a/paid' }] })
  });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'openrouter', apiKey: 'k' });
  assert.deepEqual(plain(await translator.listModels()), ['a/model:free', 'a/paid', 'b/paid']);
});

// ---------------------------------------------------------------- TranslationService
test('TranslationService: 快取、去重、純數字不送出', async () => {
  const { context, fetchCalls } = loadBackground({
    storage: { triggerTranslationSource: 'bing' },
    fetch: async (url, init) => {
      if (url.includes('translate/auth')) return new Response('token');
      const items = JSON.parse(init.body);
      return jsonResponse(items.map(item => ({ translations: [{ text: `[${item.Text}]` }] })));
    }
  });
  const first = await context.TranslationService.translate({ role: 'trigger', texts: ['Hi', '123', 'Hi', 'Bye'], targetLang: 'en' });
  assert.deepEqual(plain(first), { translations: ['[Hi]', '123', '[Hi]', '[Bye]'], error: null });
  const translateRequests = () => fetchCalls.filter(c => c.url.includes('/translate?'));
  assert.equal(translateRequests().length, 1);
  assert.equal(JSON.parse(translateRequests()[0].init.body).length, 2);

  const second = await context.TranslationService.translate({ role: 'trigger', texts: ['Bye'], targetLang: 'en' });
  assert.deepEqual(plain(second.translations), ['[Bye]']);
  assert.equal(translateRequests().length, 1, '第二次應該直接吃記憶體快取');
});

test('TranslationService: 失敗時原文奉還並附上錯誤', async () => {
  const { context } = loadBackground({
    storage: { triggerTranslationSource: 'google-api' }
  });
  const result = plain(await context.TranslationService.translate({ role: 'trigger', texts: ['Hello'], targetLang: 'zh-TW' }));
  assert.deepEqual(result.translations, ['Hello']);
  assert.equal(result.error.code, 'config');
  assert.equal(result.error.provider, 'Cloud Translation');
});

test('TranslationService: 舊版 mistral-api 設定自動轉成 Mistral LLM', async () => {
  const { context, fetchCalls } = loadBackground({
    storage: { triggerTranslationSource: 'mistral-api', mistralApiKey: 'old-key' },
    fetch: async () => chatResponse('你好')
  });
  const result = plain(await context.TranslationService.translate({ role: 'trigger', texts: ['Hello'], targetLang: 'zh-TW' }));
  assert.deepEqual(result.translations, ['你好']);
  assert.equal(fetchCalls[0].url, 'https://api.mistral.ai/v1/chat/completions');
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer old-key');
});

test('TranslationService: 換了 LLM 設定就用新的供應商，並套用自訂 prompt', async () => {
  const { context, chrome, fetchCalls } = loadBackground({
    storage: { triggerTranslationSource: 'llm' },
    fetch: async () => chatResponse('好')
  });
  chrome.storage.local.set({
    llmSettings: { provider: 'ollama-local', providers: { 'ollama-local': { model: 'qwen3' } } },
    customPrompts: [{ name: 'p', content: 'Translate into ${fullTargetLang} like a pirate.' }],
    customPromptIndex: 0
  });
  await context.TranslationService.translate({ role: 'trigger', texts: ['Hi'], targetLang: 'ja' });
  assert.equal(fetchCalls[0].url, 'http://localhost:11434/v1/chat/completions');
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(body.model, 'qwen3');
  assert.match(body.messages[0].content, /^Translate into Japanese like a pirate\./);
});

test('TranslationService: 開啟本地快取時會寫入並讀回', async () => {
  let calls = 0;
  const { context, diskCache } = loadBackground({
    storage: { useDiskCache: true, triggerTranslationSource: 'deepl-api', deepLApiKey: 'k:fx' },
    fetch: async () => {
      calls++;
      return jsonResponse({ translations: [{ text: '世界' }] });
    }
  });
  await context.TranslationService.translate({ texts: ['World'], targetLang: 'zh-TW' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(diskCache.get('World_zh-TW'), '世界');
  context.TranslationService.clearMemoryCache();
  const again = plain(await context.TranslationService.translate({ texts: ['World'], targetLang: 'zh-TW' }));
  assert.deepEqual(again.translations, ['世界']);
  assert.equal(calls, 1);
});

// ---------------------------------------------------------------- 不用預填充
test('OpenAICompatibleTranslator: 只送 system + user，不用 assistant 預填充', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      return body.response_format ? chatResponse('{"segments":["一","二"]}') : chatResponse('一');
    }
  });
  const translator = new context.OpenAICompatibleTranslator({ provider: 'mistral', apiKey: 'k' });
  await translator.translateBatch(['one'], 'zh-TW');
  await translator.translateBatch(['one', 'two'], 'zh-TW');
  await translator.translateBatch(['<b id="g0">one</b>'], 'zh-TW', 'auto', { html: true });
  for (const call of fetchCalls) {
    const body = JSON.parse(call.init.body);
    assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);
    assert.ok(body.messages.every(m => !('prefix' in m)), '不能帶 Mistral 專用的 prefix');
  }
});

test('PostProcess: 砍掉模型自己加的開場白，但不誤砍譯文', () => {
  const { context } = loadBackground();
  const clean = context.PostProcess.cleanLLMOutput;
  assert.equal(clean("Here's the translation into Traditional Chinese:\n你好，世界"), '你好，世界');
  assert.equal(clean('Sure! Here is the translated text:\n\n你好'), '你好');
  assert.equal(clean('以下是翻譯結果：\n你好'), '你好');
  assert.equal(clean('翻譯：\n你好'), '你好');
  // 這些是真正的譯文，不能砍
  assert.equal(clean('這裡是我的家：\n溫暖又舒適'), '這裡是我的家：\n溫暖又舒適');
  assert.equal(clean('Here is my home: warm and cozy'), 'Here is my home: warm and cozy');
  assert.equal(clean('他說：\n「你好」'), '他說：\n「你好」');
});

// ---------------------------------------------------------------- 字典
test('Dictionary.lookup: 取出音標與前幾個解釋，非英文單字不查', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async url => url.endsWith('/fox')
      ? jsonResponse([{
        word: 'fox',
        phonetics: [{ audio: '' }, { text: '/fɒks/' }],
        meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: 'A small wild canine.' }] },
          { partOfSpeech: 'verb', definitions: [{ definition: 'To trick or fool.' }] }
        ]
      }])
      : new Response('{"title":"No Definitions Found"}', { status: 404 })
  });
  const result = plain(await context.Dictionary.lookup('Fox'));
  assert.deepEqual(result, {
    phonetic: '/fɒks/',
    meanings: [
      { partOfSpeech: 'noun', definition: 'A small wild canine.' },
      { partOfSpeech: 'verb', definition: 'To trick or fool.' }
    ]
  });
  assert.equal(await context.Dictionary.lookup('asdfqwer'), null);
  assert.equal(await context.Dictionary.lookup('林楓'), null);
  assert.equal(await context.Dictionary.lookup('two words'), null);
  await context.Dictionary.lookup('fox');
  assert.equal(fetchCalls.length, 2, '查過的字要快取，非英文單字不送出');
});

test('OpenAICompatibleTranslator: Gemini / Groq 預設值，Gemini 模型清單拿掉 models/ 前綴', async () => {
  const { context, fetchCalls } = loadBackground({
    fetch: async url => url.endsWith('/models')
      ? jsonResponse({ data: [{ id: 'models/gemini-3.5-flash-lite' }, { id: 'models/gemini-3.8-flash' }] })
      : chatResponse('你好')
  });
  const gemini = new context.OpenAICompatibleTranslator({ provider: 'gemini', apiKey: 'g' });
  await gemini.translateBatch(['Hello'], 'zh-TW');
  assert.equal(fetchCalls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(JSON.parse(fetchCalls[0].init.body).model, 'gemini-3.5-flash-lite');
  assert.deepEqual(plain(await gemini.listModels()), ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);

  const groq = new context.OpenAICompatibleTranslator({ provider: 'groq', apiKey: 'q' });
  await groq.translateBatch(['Hello'], 'zh-TW');
  const groqCall = fetchCalls.find(c => c.url.includes('groq'));
  assert.equal(groqCall.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(JSON.parse(groqCall.init.body).model, 'qwen/qwen3.8-27b');
  await assert.rejects(new context.OpenAICompatibleTranslator({ provider: 'groq' }).translateBatch(['a'], 'zh-TW'), { code: 'config' });
});

// ---------------------------------------------------------------- 暫時性錯誤
test('safeFetch: 5xx 和連線失敗會重試，429 不重試', async () => {
  let calls = 0;
  const { context } = loadBackground({
    fetch: async () => {
      calls++;
      if (calls === 1) throw new TypeError('Failed to fetch');
      if (calls === 2) return new Response('busy', { status: 502 });
      return jsonResponse([['你好']]);
    }
  });
  const response = await context.safeFetch('https://x.test/', {}, 'Test');
  assert.equal(response.status, 200);
  assert.equal(calls, 3);

  calls = 0;
  const limited = loadBackground({ fetch: async () => { calls++; return new Response('slow down', { status: 429 }); } });
  assert.equal((await limited.context.safeFetch('https://x.test/', {}, 'Test')).status, 429);
  assert.equal(calls, 1);
});

test('Google 502 錯誤頁：重試後還是失敗，只顯示標題不塞整頁 HTML', async () => {
  const page = '<!DOCTYPE html>\n<html lang=en>\n<meta charset=utf-8>\n<title>Error 502 (Server Error)!!1</title>\n<style>*{margin:0}</style><p>long body</p>';
  let translateCalls = 0;
  const { context } = loadBackground({
    fetch: async url => {
      if (url.includes('translate_http')) return new Response('');
      translateCalls++;
      return new Response(page, { status: 502, statusText: '' });
    }
  });
  const result = plain(await context.TranslationService.translate({ texts: ['Hello'], targetLang: 'zh-TW' }));
  assert.deepEqual(result.translations, ['Hello']);
  assert.equal(result.error.message, 'Google Translate 502 Error 502 (Server Error)!!1');
  assert.equal(translateCalls, 3, '第一次＋重試兩次');
});
