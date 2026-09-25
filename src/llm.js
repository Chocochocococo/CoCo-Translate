// llm.js — OpenAI 相容的 AI 翻譯（Ollama Cloud / OpenRouter / Mistral / 本機 Ollama / 自訂）
"use strict";

// 各家預設值。concurrency / rpm 照各家免費方案的限制抓，別一次把額度燒光
const LLM_PRESETS = {
  'ollama-cloud': {
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    defaultModel: 'gemma4:31b',
    needsKey: true,
    concurrency: 1,          // 免費方案同時只能 1 個請求
    rpm: 0,
    jsonMode: true
  },
  'openrouter': {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemma-4-31b-it:free',
    needsKey: true,
    concurrency: 2,
    rpm: 18,                 // :free 模型每分鐘 20 次，留一點餘裕
    jsonMode: true,
    headers: {
      'HTTP-Referer': 'https://github.com/Chocochocococo/CoCo-Translate',
      'X-Title': 'CoCo Translate'
    }
  },
  'mistral': {
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    needsKey: true,
    concurrency: 1,
    rpm: 30,
    jsonMode: true
  },
  'ollama-local': {
    label: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: '',
    needsKey: false,
    concurrency: 1,
    rpm: 0,
    jsonMode: true
  },
  'custom': {
    label: 'Custom',
    baseUrl: '',
    defaultModel: '',
    needsKey: false,
    concurrency: 2,
    rpm: 0,
    jsonMode: false          // 不知道對方支不支援 response_format，保守一點
  }
};

const DEFAULT_LLM_PROMPT =
  "You are an experienced novel translator. Translate the following text into ${fullTargetLang}, " +
  "ensuring the translation is fluent, natural, and retains the original tone and style. " +
  "Preserve the original names as they appear in the source text. When describing body parts, use precise anatomical terminology. " +
  "Preserve the original formatting exactly as it appears.";

// 同一個 baseUrl 共用一條佇列，換模型或重建翻譯器都不會突破限流
const llmQueues = new Map();
const getLLMQueue = (baseUrl, preset) => {
  if (!llmQueues.has(baseUrl)) {
    llmQueues.set(baseUrl, new RequestQueue({ concurrency: preset.concurrency, rpm: preset.rpm }));
  }
  return llmQueues.get(baseUrl);
};

/**
 * 從模型回覆裡挖出 {"segments": [...]}，挖不到或數量不對就回傳 null
 */
const parseSegmentsResponse = (content, expectedLength) => {
  const cleaned = PostProcess.cleanLLMOutput(content || '');
  const start = cleaned.search(/[\[{]/);
  if (start === -1) return null;
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return null;
  }
  const segments = Array.isArray(parsed) ? parsed : parsed?.segments ?? parsed?.translations;
  if (!Array.isArray(segments) || segments.length !== expectedLength) return null;
  if (!segments.every(s => typeof s === 'string')) return null;
  return segments;
};

class OpenAICompatibleTranslator {
  /**
   * @param {Object} config
   * @param {string} config.provider LLM_PRESETS 的 key
   * @param {string} [config.apiKey]
   * @param {string} [config.model]
   * @param {string} [config.baseUrl]
   * @param {string} [config.customPrompt]
   */
  constructor({ provider = 'ollama-cloud', apiKey = '', model = '', baseUrl = '', customPrompt = '' } = {}) {
    this.preset = LLM_PRESETS[provider] || LLM_PRESETS.custom;
    this.provider = provider;
    this.label = this.preset.label;
    this.apiKey = apiKey;
    this.model = model || this.preset.defaultModel;
    this.baseUrl = (baseUrl || this.preset.baseUrl).replace(/\/+$/, '');
    this.customPrompt = customPrompt;
    this.isLLM = true;
    // 每批不要太大：小模型一次吃太多段很容易漏段
    this.maxBatchItems = 40;
    this.maxBatchChars = 3000;
    this.queue = this.baseUrl ? getLLMQueue(this.baseUrl, this.preset) : null;
  }

  checkConfig() {
    if (!this.baseUrl) throw new TranslationError('config', `${this.label}: please enter the API base URL`);
    if (this.preset.needsKey && !this.apiKey) throw new TranslationError('config', `Please enter the ${this.label} API key!`);
    if (!this.model) throw new TranslationError('config', `${this.label}: please choose a model`);
  }

  buildBasePrompt(targetLang) {
    const fullTargetLang = getLanguageFullName(targetLang);
    const template = this.customPrompt && this.customPrompt.trim() ? this.customPrompt : DEFAULT_LLM_PROMPT;
    return template.replace(/\$\{fullTargetLang\}/g, fullTargetLang);
  }

  async chat(messages, { json = false } = {}) {
    const payload = { model: this.model, messages, temperature: 0.3, stream: false };
    if (json && this.preset.jsonMode) payload.response_format = { type: 'json_object' };

    const headers = { 'Content-Type': 'application/json', ...(this.preset.headers || {}) };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const response = await this.queue.run(() => safeFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }, this.label));

    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    if (data?.error) {
      throw new TranslationError('http', `${this.label}: ${data.error.message || JSON.stringify(data.error)}`);
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new TranslationError('bad_response', `${this.label}: empty response`);
    }
    return content;
  }

  markupInstructions(html) {
    return html
      ? ` The text contains inline HTML tags with id attributes (for example <b id="g0">…</b> or <img id="x1">). ` +
        `Keep every tag with its id exactly once, keep the nesting, and move each tag so it wraps the matching translated words. ` +
        `Do not add, remove or rename tags.`
      : '';
  }

  async translateOne(text, targetLang, { html = false } = {}) {
    const fullTargetLang = getLanguageFullName(targetLang);
    const systemPrompt = `${this.buildBasePrompt(targetLang)}${this.markupInstructions(html)} Only return the translation, nothing else. Do not use any Markdown formatting.`;
    const content = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Translate the following into ${fullTargetLang}:\n${text}` }
    ]);
    return PostProcess.cleanLLMOutput(content);
  }

  async translateSegments(texts, targetLang, { html = false } = {}) {
    const fullTargetLang = getLanguageFullName(targetLang);
    const systemPrompt =
      `${this.buildBasePrompt(targetLang)}${this.markupInstructions(html)}\n\n` +
      `You will receive a JSON object {"segments": [...]}. The segments are consecutive fragments of the same web page. ` +
      `Translate every segment into ${fullTargetLang}. ` +
      `Respond with only a JSON object {"segments": [...]} containing exactly ${texts.length} strings in the same order. ` +
      `Never merge, split, drop or reorder segments. If a segment should not be translated (code, URL, proper noun), copy it unchanged. ` +
      `Do not use any Markdown formatting.`;
    const content = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify({ segments: texts }) }
    ], { json: true });
    return parseSegmentsResponse(content, texts.length);
  }

  async translateBatch(texts, targetLang = 'zh-TW', sourceLang = 'auto', options = {}) {
    this.checkConfig();
    if (texts.length === 1) return [await this.translateOne(texts[0], targetLang, options)];

    const segments = await this.translateSegments(texts, targetLang, options);
    if (segments) return segments.map(s => PostProcess.cleanLLMOutput(s));

    // 模型漏段或格式亂掉：對半切再試，切到很小還是不行就一段一段翻
    console.warn(`${this.label}: 分段數量對不上，把批次切小重試（${texts.length} 段）`);
    if (texts.length > 4) {
      const mid = Math.ceil(texts.length / 2);
      const [first, second] = await Promise.all([
        this.translateBatch(texts.slice(0, mid), targetLang, sourceLang, options),
        this.translateBatch(texts.slice(mid), targetLang, sourceLang, options)
      ]);
      return first.concat(second);
    }
    const results = [];
    for (const text of texts) results.push(await this.translateOne(text, targetLang, options));
    return results;
  }

  /**
   * 取得模型清單（OpenRouter 的免費模型排前面）
   * @returns {Promise<string[]>}
   */
  async listModels() {
    if (!this.baseUrl) throw new TranslationError('config', `${this.label}: please enter the API base URL`);
    const headers = { ...(this.preset.headers || {}) };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    const response = await safeFetch(`${this.baseUrl}/models`, { headers }, this.label);
    if (!response.ok) throw await httpError(response, this.label);
    const data = await response.json();
    const ids = (data?.data || data?.models || [])
      .map(m => m.id || m.name || m.model)
      .filter(Boolean);
    const isFree = id => /:free$/.test(id);
    return [...new Set(ids)].sort((a, b) => (isFree(b) - isFree(a)) || a.localeCompare(b));
  }
}

Object.assign(globalThis, { LLM_PRESETS, DEFAULT_LLM_PROMPT, OpenAICompatibleTranslator, parseSegmentsResponse });
