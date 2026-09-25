// translator.js — 傳統翻譯來源（Google / Cloud Translation / Bing / DeepL）
// 全部在 background 執行，每個來源都實作 translateBatch(texts, targetLang, sourceLang)
"use strict";

// 全名映射，給 LLM prompt 用
const languageFullNames = {
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh-tw': 'Taiwan Traditional Chinese',
  'zh': 'Taiwan Traditional Chinese',
  'zh-cn': 'Simplified Chinese',
  'fr': 'French',
  'de': 'German',
  'es': 'Spanish',
  'pt': 'Portuguese',
  'ru': 'Russian',
  'th': 'Thai',
  'vi': 'Vietnamese'
};

const getLanguageFullName = lang => languageFullNames[(lang || '').toLowerCase()] || lang;

// 翻譯失敗時統一丟這個，content script 會依 code 顯示提示
class TranslationError extends Error {
  /**
   * @param {'auth'|'quota'|'config'|'network'|'bad_response'|'http'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'TranslationError';
    this.code = code;
  }
}

const httpError = async (response, providerLabel) => {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 300);
  } catch (e) {
    // 讀不到就算了
  }
  const status = response.status;
  let code = 'http';
  if (status === 401 || status === 403) code = 'auth';
  else if (status === 402 || status === 429 || status === 456) code = 'quota';
  return new TranslationError(code, `${providerLabel} ${status} ${response.statusText} ${detail}`.trim());
};

// fetch 本身失敗（斷網、DNS、CORS）也包成 TranslationError
const safeFetch = async (url, options, providerLabel) => {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new TranslationError('network', `${providerLabel}: ${error.message}`);
  }
};

// ------------------------- Google（免金鑰） -------------------------
class GoogleHelper_v2 {
  static #lastRequestAuthTime = 0;
  static #translateAuth = null;
  static #authNotFound = false;
  static #authPromise = null;

  static #alternativeKey = new TextDecoder().decode(
    new Uint8Array([
      65, 73, 122, 97, 83, 121, 65, 84, 66, 88, 97, 106, 118, 122, 81,
      76, 84, 68, 72, 69, 81, 98, 99, 112, 113, 48, 73, 104, 101, 48,
      118, 87, 68, 72, 109, 79, 53, 50, 48,
    ])
  );

  static get translateAuth() {
    return GoogleHelper_v2.#translateAuth || GoogleHelper_v2.#alternativeKey;
  }

  static async findAuth() {
    if (GoogleHelper_v2.#authPromise) return GoogleHelper_v2.#authPromise;

    // 抓到金鑰 20 分鐘更新一次、抓不到 5 分鐘再試
    const maxAge = (GoogleHelper_v2.#translateAuth && !GoogleHelper_v2.#authNotFound ? 20 : 5) * 60 * 1000;
    if (Date.now() - GoogleHelper_v2.#lastRequestAuthTime < maxAge) return;

    GoogleHelper_v2.#authPromise = (async () => {
      GoogleHelper_v2.#lastRequestAuthTime = Date.now();
      try {
        // service worker 沒有 XMLHttpRequest，改用 fetch
        const response = await fetch(
          "https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main"
        );
        const text = response.ok ? await response.text() : '';
        const result = text.match(/['"]x\-goog\-api\-key['"]\s*\:\s*['"](\w{39})['"]/i);
        if (result && result.length === 2) {
          GoogleHelper_v2.#translateAuth = result[1];
          GoogleHelper_v2.#authNotFound = false;
        } else {
          GoogleHelper_v2.#authNotFound = true;
        }
      } catch (e) {
        console.error('Fuck, Google 金鑰抓不到，改用備用金鑰:', e);
        GoogleHelper_v2.#authNotFound = true;
      }
    })().finally(() => {
      GoogleHelper_v2.#authPromise = null;
    });

    return GoogleHelper_v2.#authPromise;
  }
}

class GoogleTranslator {
  constructor() {
    this.label = 'Google Translate';
    this.baseUrl = 'https://translate-pa.googleapis.com/v1/translateHtml';
    this.maxBatchItems = 100;
    this.maxBatchChars = 5000;
    this.queue = new RequestQueue({ concurrency: 4 });
  }

  async translateBatch(texts, targetLang = 'zh-TW', sourceLang = 'auto', { html = false } = {}) {
    await GoogleHelper_v2.findAuth();
    // translateHtml 會把輸入當 HTML：純文字先跳脫、回來再解碼，不然 "a < b" 會變成 "a &lt; b"
    // 換行也會被當空白吃掉，先換成 <br>
    const prepare = text => Markup.newlinesToBr(html ? text : PostProcess.escapeHtml(text));
    const requestBody = JSON.stringify([[texts.map(prepare), sourceLang, targetLang], "te"]);

    const response = await this.queue.run(() => safeFetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json+protobuf',
        'X-goog-api-key': GoogleHelper_v2.translateAuth
      },
      body: requestBody
    }, this.label));

    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    if (!Array.isArray(data?.[0]) || data[0].length !== texts.length) {
      throw new TranslationError('bad_response', 'Google Translate: unexpected response');
    }
    return data[0].map(text => {
      const restored = Markup.brToNewlines(text ?? '');
      return html ? restored : PostProcess.decodeHtmlEntities(restored);
    });
  }
}

// ------------------------- Google Cloud Translation -------------------------
class GoogleApiKeyTranslator {
  constructor(apiKey) {
    this.label = 'Cloud Translation';
    this.apiKey = apiKey;
    this.baseUrl = 'https://translation.googleapis.com/language/translate/v2';
    this.maxBatchItems = 100;
    this.maxBatchChars = 5000;
    this.queue = new RequestQueue({ concurrency: 4 });
  }

  async translateBatch(texts, targetLang = 'zh-TW', sourceLang = 'auto', { html = false } = {}) {
    if (!this.apiKey) throw new TranslationError('config', 'Please enter the Cloud API key!');
    const body = html
      ? { q: texts.map(Markup.newlinesToBr), target: targetLang, format: "html" }
      : { q: texts, target: targetLang, format: "text" };
    if (sourceLang !== 'auto') body.source = sourceLang;

    const response = await this.queue.run(() => safeFetch(`${this.baseUrl}?key=${encodeURIComponent(this.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, this.label));

    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    const translations = data?.data?.translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
      throw new TranslationError('bad_response', 'Invalid Cloud Translation response, fuck!');
    }
    return translations.map(t => (html ? Markup.brToNewlines(t.translatedText ?? '') : t.translatedText ?? ''));
  }
}

// ------------------------- Bing（Edge token） -------------------------
class BingHelper {
  static #auth = null;
  static #lastRequestTime = 0;

  static async findAuth(force = false) {
    // Edge 的 token 大約 10 分鐘過期，8 分鐘就換新的
    if (!force && BingHelper.#auth && Date.now() - BingHelper.#lastRequestTime < 8 * 60 * 1000) {
      return BingHelper.#auth;
    }
    const response = await safeFetch("https://edge.microsoft.com/translate/auth", {}, 'Bing');
    if (!response.ok) throw await httpError(response, 'Bing auth');
    const token = await response.text();
    if (!token || token.length < 2) throw new TranslationError('auth', 'Invalid Bing auth token');
    BingHelper.#auth = token;
    BingHelper.#lastRequestTime = Date.now();
    return token;
  }
}

// Microsoft Translator 的中文代碼跟別人不一樣
const BING_LANG_MAP = { 'zh-tw': 'zh-Hant', 'zh': 'zh-Hant', 'zh-cn': 'zh-Hans' };

class BingTranslator {
  constructor() {
    this.label = 'Bing';
    this.baseUrl = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0';
    this.maxBatchItems = 100;
    this.maxBatchChars = 5000;
    this.queue = new RequestQueue({ concurrency: 4 });
  }

  async translateBatch(texts, targetLang = 'zh-TW', sourceLang = 'auto', { html = false } = {}) {
    const to = BING_LANG_MAP[targetLang.toLowerCase()] || targetLang;
    let url = `${this.baseUrl}&to=${encodeURIComponent(to)}`;
    if (sourceLang !== 'auto') url += `&from=${encodeURIComponent(BING_LANG_MAP[sourceLang.toLowerCase()] || sourceLang)}`;
    if (html) url += '&textType=html';
    const body = JSON.stringify(texts.map(text => ({ Text: html ? Markup.newlinesToBr(text) : text })));

    const send = token => this.queue.run(() => safeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'authorization': 'Bearer ' + token },
      body
    }, this.label));

    let response = await send(await BingHelper.findAuth());
    if (response.status === 401) {
      // token 過期就換一個再試一次
      response = await send(await BingHelper.findAuth(true));
    }
    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new TranslationError('bad_response', 'Invalid Bing translation response');
    }
    return data.map(item => {
      const text = item?.translations?.[0]?.text ?? '';
      return html ? Markup.brToNewlines(text) : text;
    });
  }
}

// ------------------------- DeepL -------------------------
// DeepL 的目標語言代碼：繁中是 ZH-HANT，英文要指定 EN-US / EN-GB
const DEEPL_TARGET_MAP = { 'zh-tw': 'ZH-HANT', 'zh': 'ZH-HANT', 'zh-cn': 'ZH-HANS', 'en': 'EN-US', 'pt': 'PT-BR' };

class DeepLTranslator {
  constructor(apiKey, accountType = 'free') {
    this.label = 'DeepL';
    this.apiKey = apiKey;
    // 免費版金鑰結尾一定是 ":fx"，有就直接判定為免費版
    const isFree = apiKey.endsWith(':fx') || accountType !== 'pro';
    this.baseUrl = isFree ? 'https://api-free.deepl.com/v2/translate' : 'https://api.deepl.com/v2/translate';
    this.maxBatchItems = 50;
    this.maxBatchChars = 20000;
    this.queue = new RequestQueue({ concurrency: 2 });
  }

  async translateBatch(texts, targetLang = 'zh-TW', sourceLang = 'auto', { html = false } = {}) {
    if (!this.apiKey) throw new TranslationError('config', 'Please enter the DeepL API key!');
    const body = {
      text: html ? texts.map(Markup.newlinesToBr) : texts,
      target_lang: DEEPL_TARGET_MAP[targetLang.toLowerCase()] || targetLang.toUpperCase()
    };
    if (html) body.tag_handling = 'html';
    if (sourceLang !== 'auto') body.source_lang = sourceLang.split('-')[0].toUpperCase();

    const response = await this.queue.run(() => safeFetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `DeepL-Auth-Key ${this.apiKey}`
      },
      body: JSON.stringify(body)
    }, this.label));

    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    if (!Array.isArray(data?.translations) || data.translations.length !== texts.length) {
      throw new TranslationError('bad_response', 'Invalid DeepL translation response, fuck!');
    }
    return data.translations.map(t => (html ? Markup.brToNewlines(t.text ?? '') : t.text ?? ''));
  }
}

Object.assign(globalThis, {
  languageFullNames, getLanguageFullName, TranslationError, httpError, safeFetch,
  GoogleTranslator, GoogleApiKeyTranslator, BingTranslator, DeepLTranslator
});
