//translator.js
"use strict";
const MAX_CONCURRENT_FETCHES = 5;
let activeFetches = 0;

async function limitedFetch(url, options) {
  while (activeFetches >= MAX_CONCURRENT_FETCHES) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  activeFetches++;
  try {
    return await fetch(url, options);
  } finally {
    activeFetches--;
  }
}

// 取得使用者是否啟用本地快取設定（這裡統一用 local 存取）
function getUserCacheSetting() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['useDiskCache'], (result) => {
      if (chrome.runtime.lastError) {
        console.error('Fuck, 無法取得設定:', chrome.runtime.lastError);
        return resolve(false);
      }
      resolve(result.useDiskCache || false);
    });
  });
}
// 全名映射的全域變數
const languageFullNames = {
  'en': 'English',
  'ja': 'Japanese',
  'ko': 'Korean',
  'zh-tw': 'Taiwan Traditional Chinese',
  'zh': 'Taiwan Traditional Chinese'
};

// === 假設 TranslationCache 已從 translationCache.js 引入 ===
// TranslationCache 會提供以下介面：
// - TranslationCache.getTranslation(originalText, targetLang)
// - TranslationCache.setTranslation(originalText, translatedText, targetLang, detectedLanguage)

// ------------------------- GoogleHelper_v2 -------------------------
// 這裡我們直接把 GoogleHelper_v2 的認證邏輯整合進來，別他媽搞分家
class GoogleHelper_v2 {
  static #lastRequestAuthTime = null;
  static #translateAuth = null;
  static #AuthNotFound = false;
  static #authPromise = null;

  static get translateAuth() {
    return GoogleHelper_v2.#translateAuth;
  }

  static async findAuth() {
    if (GoogleHelper_v2.#authPromise)
      return await GoogleHelper_v2.#authPromise;

    GoogleHelper_v2.#authPromise = new Promise((resolve) => {
      let updateGoogleAuth = false;
      if (GoogleHelper_v2.#lastRequestAuthTime) {
        const date = new Date();
        if (GoogleHelper_v2.#translateAuth) {
          date.setMinutes(date.getMinutes() - 20);
        } else if (GoogleHelper_v2.#AuthNotFound) {
          date.setMinutes(date.getMinutes() - 5);
        } else {
          date.setMinutes(date.getMinutes() - 1);
        }
        if (date.getTime() > GoogleHelper_v2.#lastRequestAuthTime) {
          updateGoogleAuth = true;
        }
      } else {
        updateGoogleAuth = true;
      }

      if (updateGoogleAuth) {
        GoogleHelper_v2.#lastRequestAuthTime = Date.now();

        const alternativeKey = new TextDecoder().decode(
          new Uint8Array([
            65, 73, 122, 97, 83, 121, 65, 84, 66, 88, 97, 106, 118, 122, 81,
            76, 84, 68, 72, 69, 81, 98, 99, 112, 113, 48, 73, 104, 101, 48,
            118, 87, 68, 72, 109, 79, 53, 50, 48,
          ])
        );

        const http = new XMLHttpRequest();
        http.open(
          "GET",
          "https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main"
        );
        http.send();
        http.onload = (e) => {
          if (http.responseText && http.responseText.length > 1) {
            const result = http.responseText.match(
              /['"]x\-goog\-api\-key['"]\s*\:\s*['"](\w{39})['"]/i
            );
            console.log(result);
            if (result && result.length === 2) {
              GoogleHelper_v2.#translateAuth = result[1];
              GoogleHelper_v2.#AuthNotFound = false;
            } else {
              GoogleHelper_v2.#AuthNotFound = true;
              GoogleHelper_v2.#translateAuth = alternativeKey;
            }
          } else {
            GoogleHelper_v2.#AuthNotFound = true;
            GoogleHelper_v2.#translateAuth = alternativeKey;
          }
          resolve();
        };
        http.onerror =
          http.onabort =
          http.ontimeout =
            (e) => {
              console.error(e);
              GoogleHelper_v2.#translateAuth = alternativeKey;
              resolve();
            };
      } else {
        resolve();
      }
    });

    GoogleHelper_v2.#authPromise.finally(() => {
      GoogleHelper_v2.#authPromise = null;
    });

    return await GoogleHelper_v2.#authPromise;
  }
}

// ------------------------- GoogleTranslator -------------------------
// 這是你的翻譯擴充程式碼，我們用新版 API，整合上面那套 GoogleHelper_v2 邏輯
class GoogleTranslator {
  constructor() {
    // 改用新版 API 的 URL
    this.baseUrl = 'https://translate-pa.googleapis.com/v1/translateHtml';
    this.rawCache = new Map();
    this.formattedCache = new Map();
  }

  async translate(text, targetLang = 'zh-TW', sourceLang = 'auto') {
    const originalText = text;
    const cacheKey = `${text}__${targetLang}`;
    // 檢查暫存，若有就他媽直接回傳
    if (this.rawCache.has(cacheKey)) {
      let rawResult = this.rawCache.get(cacheKey);
      let updated = await applyRegexPatterns(rawResult);
      if (!['en', 'ko'].includes(targetLang)) {
        updated = updated.replace(/["“”](.+?)["”]/g, '「$1」').replace(/”/g, '」');
      }
      this.formattedCache.set(cacheKey, updated);
      return updated;
    }

    try {
      // 先用 GoogleHelper_v2 抓最新 API 金鑰，確保咱媽的請求不會被擋
      await GoogleHelper_v2.findAuth();
      const authKey = GoogleHelper_v2.translateAuth;

      // 組裝請求 body，這格式跟你的 googleService 一致
      const requestBody = JSON.stringify([
        [
          [text],
          sourceLang,
          targetLang
        ],
        "te"
      ]);

      // 發送 POST 請求到新版的 API
      const response = await limitedFetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/application/json+protobuf',
          'X-goog-api-key': authKey
        },
        body: requestBody
      });

      if (!response.ok) throw new Error('Translation request failed');
      const data = await response.json();

      // 解析回應，假設回傳資料結構跟 googleService 一樣
      let rawResult = data[0].map((text, index) => text).join('');
      
      // 存進暫存
      this.rawCache.set(cacheKey, rawResult);
      
      let formattedResult = await applyRegexPatterns(rawResult);
      if (!['en', 'ko'].includes(targetLang)) {
        formattedResult = formattedResult
          .replace(/["“”](.+?)["”]/g, '「$1」')
          .replace(/”/g, '」')
          .replace(/“/g, '「');
      }
      this.formattedCache.set(cacheKey, formattedResult);
      return formattedResult;
    } catch (error) {
      console.error('GoogleTranslator error:', error);
      return originalText;
    }
  }

  async translateInputText(inputText, targetLang = 'en', sourceLang = 'auto') {
    if (!inputText?.trim()) return '';
    return await this.translate(inputText, targetLang, sourceLang);
  }
}

// ------------------------- GoogleApiKeyTranslator -------------------------
class GoogleApiKeyTranslator {
  constructor(apiKey) {
    this.apiKey = apiKey; // 用戶輸入的 API key
    this.baseUrl = 'https://translation.googleapis.com/language/translate/v2';
    this.rawCache = new Map();
    this.formattedCache = new Map();
  }

  async translate(text, targetLang = 'zh-TW', sourceLang = 'auto') {
    const originalText = text;
    const cacheKey = `${text}__${targetLang}`;
    const useDiskCache = await getUserCacheSetting();

    // 先檢查 in-memory 暫存
    if (this.rawCache.has(cacheKey)) {
      let rawResult = this.rawCache.get(cacheKey);
      let updated = await applyRegexPatterns(rawResult);
      if (!['en', 'ko'].includes(targetLang)) {
        updated = updated.replace(/["“”](.+?)["”]/g, '「$1」').replace(/”/g, '」');
      }
      this.formattedCache.set(cacheKey, updated);
      return updated;
    }

    // 如果啟用本地快取，檢查 TranslationCache
    if (useDiskCache) {
      const diskCached = await TranslationCache.getTranslation(text, targetLang);
      if (diskCached) {
        console.log('從本地快取拿到資料，真他媽的爽！');
        return diskCached;
      }
    }

    try {
      // 呼叫翻譯 API
      const url = `${this.baseUrl}?key=${this.apiKey}`;
      const body = {
        q: text,
        target: targetLang,
        format: "text"
      };
      if (sourceLang !== 'auto') {
        body.source = sourceLang;
      }

      const response = await limitedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Translation request fucked up! Status: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const data = await response.json();
      if (data && data.data && data.data.translations && data.data.translations.length > 0) {
        const translatedText = data.data.translations[0].translatedText;
        // 存入原始譯文
        this.rawCache.set(cacheKey, translatedText);
        if (useDiskCache) {
          await TranslationCache.setTranslation(text, translatedText, targetLang, "und");
        }
        // 再依需要動態套用正則，供即時顯示使用
        let formattedResult = await applyRegexPatterns(translatedText);
        if (!['en', 'ko'].includes(targetLang)) {
          formattedResult = formattedResult
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        this.formattedCache.set(cacheKey, formattedResult);
        return formattedResult;
      } else {
        throw new Error('Invalid translation response, fuck!');
      }
    } catch (error) {
      console.error('GoogleApiKeyTranslator error:', error);
      return originalText;
    }
  }

  async translateInputText(inputText, targetLang = 'en', sourceLang = 'auto') {
    if (!inputText?.trim()) return '';
    return await this.translate(inputText, targetLang, sourceLang);
  }
}

// ------------------------- BingTranslator -------------------------
class BingHelper {
  static async findAuth() {
    if (BingHelper._auth && Date.now() - BingHelper._lastRequestTime < 30 * 60 * 1000) {
      return;
    }
    try {
      const response = await fetch("https://edge.microsoft.com/translate/auth");
      if (!response.ok) {
        throw new Error("Bing auth fetch failed");
      }
      const token = await response.text();
      if (token && token.length > 1) {
        BingHelper._auth = token;
        BingHelper._lastRequestTime = Date.now();
      } else {
        throw new Error("Invalid Bing auth token");
      }
    } catch (error) {
      console.error("BingHelper error:", error);
    }
  }

  static get translateAuth() {
    return BingHelper._auth;
  }
}

BingHelper._auth = null;
BingHelper._lastRequestTime = 0;

class BingTranslator {
  constructor() {
    this.baseUrl = 'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true';
    this.rawCache = new Map();
    this.formattedCache = new Map();
  }

  async translate(text, targetLang = 'zh-TW', sourceLang = 'auto') {
    const originalText = text;
    const cacheKey = `${text}__${targetLang}`;
    // 檢查 in-memory 暫存
    if (this.rawCache.has(cacheKey)) {
      let rawResult = this.rawCache.get(cacheKey);
      let updated = await applyRegexPatterns(rawResult);
      if (!['en', 'ko'].includes(targetLang)) {
        updated = updated.replace(/["“”](.+?)["”]/g, '「$1」').replace(/”/g, '」');
      }
      this.formattedCache.set(cacheKey, updated);
      return updated;
    }
    
    await BingHelper.findAuth();
    const token = BingHelper.translateAuth;
    if (!token) {
      console.error("Bing auth token not available");
      return originalText;
    }
    let url = this.baseUrl;
    if (sourceLang !== 'auto') {
      url += `&from=${sourceLang}`;
    }
    url += `&to=${targetLang}`;
    const requestBody = JSON.stringify([{ text: text }]);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'authorization': 'Bearer ' + token
        },
        body: requestBody
      });
      if (!response.ok) {
        throw new Error("Bing translation request failed");
      }
      const data = await response.json();
      if (data && data[0] && data[0].translations && data[0].translations[0] && data[0].translations[0].text) {
        const rawResult = data[0].translations[0].text;
        // 存入原始譯文
        this.rawCache.set(cacheKey, rawResult);
        let formattedResult = await applyRegexPatterns(rawResult);
        if (!['en', 'ko'].includes(targetLang)) {
          formattedResult = formattedResult
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        this.formattedCache.set(cacheKey, formattedResult);
        return formattedResult;
      }
      throw new Error("Invalid Bing translation response");
    } catch (error) {
      console.error("BingTranslator error:", error);
      return originalText;
    }
  }

  async translateInputText(inputText, targetLang = 'en', sourceLang = 'auto') {
    if (!inputText?.trim()) return '';
    return await this.translate(inputText, targetLang, sourceLang);
  }
}

// ------------------------- DeepLTranslator -------------------------
class DeepLTranslator {
  constructor(apiKey, accountType = 'free') {
    this.apiKey = apiKey;
    this.accountType = accountType; // 'free' 或 'pro'
    this.baseUrl = accountType === 'pro'
      ? 'https://api.deepl.com/v2/translate'
      : 'https://api-free.deepl.com/v2/translate';
    this.rawCache = new Map();
    this.formattedCache = new Map();
    this.hasShownAlert = false;
    this.hasShownAlert2 = false;
  }

  async translate(text, targetLang = 'zh', sourceLang = 'auto') {
    const originalText = text;
    const cacheKey = `${text}__${targetLang}`;
    const useDiskCache = await getUserCacheSetting();

    if (this.rawCache.has(cacheKey)) {
      let rawResult = this.rawCache.get(cacheKey);
      let updated = await applyRegexPatterns(rawResult);
      if (!['en', 'ko'].includes(targetLang)) {
        updated = updated.replace(/["“”](.+?)["”]/g, '「$1」').replace(/”/g, '」');
      }
      this.formattedCache.set(cacheKey, updated);
      return updated;
    }

    if (useDiskCache) {
      const diskCached = await TranslationCache.getTranslation(text, targetLang);
      if (diskCached) {
        console.log('從本地快取拿到資料，真他媽的爽！');
        return diskCached;
      }
    }

    try {
      const targetLangCode = targetLang.toUpperCase();
      if (this.accountType === 'free' && (targetLangCode === 'ZH-TW' || targetLangCode === 'KO')) {
        if (!this.hasShownAlert) {
          alert(`DeepL free API does not support target language ${targetLang}. Please upgrade to Pro or select a supported language.`);
          this.hasShownAlert = true;
        }
        return text;
      }

      if (this.accountType === 'pro' && (targetLangCode === 'ZH-TW')) {
        if (!this.hasShownAlert2) {
          alert(`DeepL pro API does not support target language ${targetLang}. Please select a supported language.`);
          this.hasShownAlert2 = true;
        }
        return text;
      }

      const params = new URLSearchParams();
      params.append("auth_key", this.apiKey);
      params.append("text", text);
      params.append("target_lang", targetLangCode);
      if (sourceLang !== 'auto') {
        params.append("source_lang", sourceLang.toUpperCase());
      }

      const response = await limitedFetch(this.baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepL translation request fucked up! Status: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const data = await response.json();
      if (data && data.translations && data.translations.length > 0) {
        const translatedText = data.translations[0].text;
        this.rawCache.set(cacheKey, translatedText);
        let formattedResult = await applyRegexPatterns(translatedText);
        if (!['EN', 'KO'].includes(targetLangCode)) {
          formattedResult = formattedResult
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        this.formattedCache.set(cacheKey, formattedResult);
        if (useDiskCache) {
          await TranslationCache.setTranslation(text, translatedText, targetLang, "und");
        }
        return formattedResult;
      } else {
        throw new Error('Invalid DeepL translation response, fuck!');
      }
    } catch (error) {
      console.error('DeepLTranslator error:', error);
      return originalText;
    }
  }
}

// ------------------------- Mistral api translation -------------------------
class MistralTranslator {
  constructor(apiKey) {
    this.apiKey = apiKey; // 你他媽的 Mistral API key
    this.baseUrl = 'https://api.mistral.ai/v1/chat/completions';
    this.rawCache = new Map();
    this.formattedCache = new Map();
  }
  
  // 靜態變數，用來串連所有翻譯請求
  static lastRequestPromise = Promise.resolve();
  // 靜態變數，記錄上一次請求的時間（毫秒）
  static lastRequestTime = 0;

  /**
   * 翻譯文字，options.useDelimiter 決定是否使用分隔符模式（預設 true）
   * @param {string} text
   * @param {string} targetLang
   * @param {string} sourceLang
   * @param {Object} options - { useDelimiter: boolean }
   */
  async translate(text, targetLang = 'zh-tw', sourceLang = 'auto', options = { useDelimiter: true }) {
    const originalText = text;
    const cacheKey = `${text}__${targetLang}`;
    const useDiskCache = await getUserCacheSetting();

    // 檢查 in-memory 暫存
    if (this.rawCache.has(cacheKey)) {
      let rawResult = this.rawCache.get(cacheKey);
      let updated = await applyRegexPatterns(rawResult);
      updated = updated
        .replace(/```/g, '')
        .replace(/^The following is the translated content:\s*/i, '')
        .trim();
      if (!['en', 'ko'].includes(targetLang.toLowerCase())) {
        updated = updated
          .replace(/["“”](.+?)["”]/g, '「$1」')
          .replace(/[“](.+?)[」]/g, '「$1」')
          .replace(/[「](.+?)[”]/g, '「$1」')
          .replace(/”/g, '」')
          .replace(/“/g, '「');
      }
      this.formattedCache.set(cacheKey, updated);
      return updated;
    }

    // 如果啟用本地快取，就先檢查 disk cache
    if (useDiskCache) {
      const diskCached = await TranslationCache.getTranslation(text, targetLang);
      if (diskCached) {
        console.log('從本地快取拿到資料，真他媽的爽！');
        let updated = await applyRegexPatterns(diskCached);
        updated = updated
          .replace(/```/g, '')
          .replace(/^The following is the translated content:\s*/i, '')
          .trim();
        if (!['en', 'ko'].includes(targetLang.toLowerCase())) {
          updated = updated
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/[“](.+?)[」]/g, '「$1」')
            .replace(/[「](.+?)[”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        return updated;
      }
    }

    const getCustomPrompt = async () => {
      return new Promise(resolve => {
        chrome.storage.local.get({ customPrompts: [] }, data => {
          chrome.storage.local.get({ customPromptIndex: -1 }, result => {
            const index = result.customPromptIndex;
            if (index >= 0 && data.customPrompts && data.customPrompts[index]) {
              resolve(data.customPrompts[index].content);
            } else {
              resolve(''); // 沒有自訂 prompt時返回空字串，後續使用預設 prompt
            }
          });
        });
      });
    };

    // 透過靜態的 promise chain 保證翻譯請求是串行進行
    const resultPromise = MistralTranslator.lastRequestPromise.then(async () => {
      // 確保每個請求至少間隔 1 秒（這裡我改成 2 秒，你可以依需要調整）
      const now = Date.now();
      const elapsed = now - MistralTranslator.lastRequestTime;
      if (elapsed < 2000) {
        await new Promise(resolve => setTimeout(resolve, 2000 - elapsed));
      }
      MistralTranslator.lastRequestTime = Date.now();

      // 使用全名映射來取得正式的語言全稱
      const fullSourceLang = (sourceLang !== 'auto' && languageFullNames[sourceLang.toLowerCase()]) 
                              ? languageFullNames[sourceLang.toLowerCase()] 
                              : sourceLang;
      const fullTargetLang = languageFullNames[targetLang.toLowerCase()] || targetLang;

      let customPrompt = await getCustomPrompt();
      let basePrompt;
      if (customPrompt.trim() !== "") {
        // 將自訂 prompt 中的 "${fullTargetLang}" 文字替換成實際的 fullTargetLang
        basePrompt = customPrompt.replace(/\$\{fullTargetLang\}/g, fullTargetLang);
      } else {
        basePrompt = "You are an experienced novel translator. Translate the following text into " + fullTargetLang +
                    ", ensuring the translation is fluent, natural, and retains the original tone and style. " +
                    "Preserve the original names as they appear in the source text. When describing body parts, use precise anatomical terminology. " +
                    "Preserve the original formatting exactly as it appears.";
      }

      // 根據 options 決定使用不同的 prompt
      let systemPrompt;
      if (options.useDelimiter) {
        systemPrompt = `${basePrompt} Do not remove or alter the delimiter string '|||---DELIM---|||'. Only return the translation, nothing else. Do not use any Markdown formatting.`;
      } else {
        systemPrompt = `${basePrompt} Only return the translation, nothing else. Do not use any Markdown formatting.`;
      }
      console.log(`${systemPrompt}`);
      // 組裝 API 請求資料
      const payload = {
        model: 'mistral-large-latest',  // 修改為正確的模型名稱
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Translate the following into ${fullTargetLang}: \n${text}`
          },
          {
            role: 'assistant',
            content: 'The following is the translated content:',
            prefix: true
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      };

      const response = await limitedFetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Mistral API 請求失敗！Status: ${response.status} ${response.statusText}. Details: ${errorText}`);
      }

      const data = await response.json();
      if (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        const translatedText = data.choices[0].message.content.trim();
        this.rawCache.set(cacheKey, translatedText);
        if (useDiskCache) {
          await TranslationCache.setTranslation(text, translatedText, targetLang, "und");
        }
        let formattedResult = await applyRegexPatterns(translatedText);
        formattedResult = formattedResult
          .replace(/```/g, '')
          .replace(/^The following is the translated content:\s*/i, '')
          .trim();
        if (!['en', 'ko'].includes(targetLang.toLowerCase())) {
          formattedResult = formattedResult
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/[“](.+?)[」]/g, '「$1」')
            .replace(/[「](.+?)[”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        this.formattedCache.set(cacheKey, formattedResult);
        return formattedResult;
      } else {
        throw new Error('無效的 Mistral 翻譯回應, fuck!');
      }
    }).catch(error => {
      console.error('MistralTranslator error:', error);
      return originalText;
    });
    
    // 更新全域 promise chain
    MistralTranslator.lastRequestPromise = resultPromise.catch(() => {});
    
    return await resultPromise;
  }

  async translateInputText(inputText, targetLang = 'en', sourceLang = 'auto') {
    if (!inputText?.trim()) return '';
    // 對於用戶輸入翻譯，直接設定 useDelimiter 為 false
    return await this.translate(inputText, targetLang, sourceLang, { useDelimiter: false });
  }
}