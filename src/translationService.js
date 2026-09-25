// translationService.js — background 的翻譯總機
// content script 只丟一批文字過來，這裡負責：選翻譯來源、查快取、切批次、限流、錯誤處理
"use strict";

const TranslationService = (() => {
  const SETTING_KEYS = [
    'triggerTranslationSource', 'pageTranslationSource',
    'googleApiKey', 'deepLApiKey', 'deepLAccountType',
    'llmSettings', 'mistralApiKey',
    'customPrompts', 'customPromptIndex',
    'useDiskCache'
  ];
  const MEMORY_CACHE_LIMIT = 5000;

  let settingsPromise = null;
  const providers = new Map();
  const memoryCache = new Map();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && SETTING_KEYS.some(key => key in changes)) {
      settingsPromise = null;
      providers.clear();
    }
  });

  const getSettings = () => (settingsPromise ??= new Promise(resolve => {
    chrome.storage.local.get(SETTING_KEYS, data => resolve(data || {}));
  }));

  /**
   * 舊版只有 Mistral，這裡把舊設定轉成新的 llmSettings 格式（不會寫回 storage）
   */
  const normalizeLLMSettings = settings => {
    const llm = settings.llmSettings ? JSON.parse(JSON.stringify(settings.llmSettings)) : null;
    if (llm) {
      llm.providers ||= {};
      return llm;
    }
    return {
      provider: settings.mistralApiKey ? 'mistral' : 'ollama-cloud',
      providers: settings.mistralApiKey
        ? { mistral: { apiKey: settings.mistralApiKey, model: LLM_PRESETS.mistral.defaultModel } }
        : {}
    };
  };

  const resolveSource = (settings, role) => {
    const source = (role === 'page' ? settings.pageTranslationSource : settings.triggerTranslationSource) || 'google';
    return source === 'mistral-api' ? 'llm' : source;   // 舊設定相容
  };

  const getCustomPrompt = settings => {
    const index = settings.customPromptIndex ?? -1;
    return index >= 0 && settings.customPrompts?.[index] ? settings.customPrompts[index].content : '';
  };

  const createProvider = (source, settings) => {
    switch (source) {
      case 'bing':
        return new BingTranslator();
      case 'google-api':
        return new GoogleApiKeyTranslator(settings.googleApiKey || '');
      case 'deepl-api':
        return new DeepLTranslator(settings.deepLApiKey || '', settings.deepLAccountType || 'free');
      case 'llm': {
        const llm = normalizeLLMSettings(settings);
        const config = llm.providers[llm.provider] || {};
        return new OpenAICompatibleTranslator({
          provider: llm.provider,
          apiKey: config.apiKey || '',
          model: config.model || '',
          baseUrl: config.baseUrl || '',
          customPrompt: getCustomPrompt(settings)
        });
      }
      default:
        return new GoogleTranslator();
    }
  };

  const getProvider = (source, settings) => {
    if (!providers.has(source)) providers.set(source, createProvider(source, settings));
    return providers.get(source);
  };

  // 快取 key 帶上來源與模型，換了翻譯來源才不會拿到舊來源的譯文
  const providerCacheId = (source, provider) =>
    provider.isLLM ? `llm:${provider.baseUrl}:${provider.model}` : source;

  const memoryGet = key => {
    if (!memoryCache.has(key)) return undefined;
    const value = memoryCache.get(key);
    memoryCache.delete(key);        // 移到最後面，當作 LRU
    memoryCache.set(key, value);
    return value;
  };

  const memorySet = (key, value) => {
    memoryCache.set(key, value);
    if (memoryCache.size > MEMORY_CACHE_LIMIT) {
      memoryCache.delete(memoryCache.keys().next().value);
    }
  };

  // 純數字、標點、符號就不用浪費額度了
  const needsTranslation = text => /[\p{L}]/u.test(text);

  const chunkTexts = (texts, maxItems, maxChars) => {
    const chunks = [];
    let current = [];
    let chars = 0;
    for (const text of texts) {
      if (current.length && (current.length >= maxItems || chars + text.length > maxChars)) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(text);
      chars += text.length;
    }
    if (current.length) chunks.push(current);
    return chunks;
  };

  const toErrorPayload = (error, provider) => ({
    code: error?.code || 'unknown',
    message: error?.message || String(error),
    provider: provider?.label || ''
  });

  /**
   * @param {Object} request
   * @param {'trigger'|'page'|'input'} request.role
   * @param {string[]} request.texts 已 trim 過的文字
   * @param {string} request.targetLang
   * @param {string} [request.sourceLang]
   * @param {'text'|'html'} [request.format] html：整段連同行內標籤一起翻（見 markup.js）
   * @returns {Promise<{translations: string[], error: Object|null}>}
   */
  const translate = async ({ role = 'trigger', texts = [], targetLang = 'zh-TW', sourceLang = 'auto', format = 'text' }) => {
    const settings = await getSettings();
    const source = resolveSource(settings, role);
    const provider = getProvider(source, settings);
    const html = format === 'html';
    // 同一段文字，純文字跟段落格式的譯文不一樣（跳脫字元、標籤），快取要分開
    const cacheId = `${providerCacheId(source, provider)}${html ? '|html' : ''}`;
    const diskKey = text => (html ? `[html]${text}` : text);
    const useDiskCache = !!settings.useDiskCache;

    const raw = new Array(texts.length);
    const translated = new Array(texts.length).fill(false);
    const missing = new Map();   // text -> 需要這段譯文的 index 們

    texts.forEach((text, i) => {
      if (!text || !needsTranslation(html ? Markup.stripTags(text) : text)) {
        raw[i] = text;
        return;
      }
      const cached = memoryGet(`${cacheId}|${targetLang}|${text}`);
      if (cached !== undefined) {
        raw[i] = cached;
        translated[i] = true;
        return;
      }
      if (!missing.has(text)) missing.set(text, []);
      missing.get(text).push(i);
    });

    const fill = (text, result) => {
      memorySet(`${cacheId}|${targetLang}|${text}`, result);
      missing.get(text).forEach(i => {
        raw[i] = result;
        translated[i] = true;
      });
      missing.delete(text);
    };

    if (useDiskCache && missing.size) {
      await Promise.all([...missing.keys()].map(async text => {
        try {
          const cached = await TranslationCache.getTranslation(diskKey(text), targetLang);
          if (cached) fill(text, cached);
        } catch (e) {
          console.error('Fuck, 讀本地快取失敗:', e);
        }
      }));
    }

    let firstError = null;
    const pendingTexts = [...missing.keys()];
    const chunks = chunkTexts(pendingTexts, provider.maxBatchItems, provider.maxBatchChars);

    await Promise.all(chunks.map(async chunk => {
      try {
        const results = await provider.translateBatch(chunk, targetLang, sourceLang, { html });
        chunk.forEach((text, i) => {
          const result = results[i];
          if (typeof result !== 'string' || !result) return;
          fill(text, result);
          if (useDiskCache) {
            TranslationCache.setTranslation(diskKey(text), result, targetLang, "und")
              .catch(e => console.error('Fuck, 寫本地快取失敗:', e));
          }
        });
      } catch (error) {
        console.error(`${provider.label} error:`, error);
        firstError ??= error;
      }
    }));

    // 翻譯失敗的段落就原文奉還
    texts.forEach((text, i) => {
      if (raw[i] === undefined) raw[i] = text;
    });

    const processedIndexes = raw.map((_, i) => i).filter(i => translated[i]);
    const processed = await PostProcess.apply(processedIndexes.map(i => raw[i]), targetLang, { html });
    const translations = [...raw];
    processedIndexes.forEach((index, k) => {
      translations[index] = processed[k];
    });

    return { translations, error: firstError ? toErrorPayload(firstError, provider) : null };
  };

  const listModels = async ({ provider, apiKey, baseUrl }) => {
    const translator = new OpenAICompatibleTranslator({ provider, apiKey, baseUrl, model: 'x' });
    return translator.listModels();
  };

  const clearMemoryCache = () => memoryCache.clear();

  return { translate, listModels, clearMemoryCache, chunkTexts, normalizeLLMSettings, resolveSource, toErrorPayload };
})();

globalThis.TranslationService = TranslationService;
