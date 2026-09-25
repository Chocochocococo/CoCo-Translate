// 在 Node 的 vm 裡載入 background 用的腳本，chrome.* 與 fetch 都換成假的
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const LIBS = ['markup.js', 'sitePatterns.js', 'glossary.js', 'dictionary.js', 'postprocess.js', 'rateLimiter.js', 'translator.js', 'llm.js', 'translationService.js'];

/**
 * @param {Object} options
 * @param {Object} [options.storage] chrome.storage.local 的初始內容
 * @param {Function} [options.fetch] (url, init) => Response
 */
export function loadBackground({ storage = {}, fetch } = {}) {
  const store = { ...storage };
  const changeListeners = [];
  const diskCache = new Map();

  const chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || store);
          const result = {};
          for (const key of list) if (key in store) result[key] = structuredClone(store[key]);
          callback(result);
        },
        set(items, callback) {
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: store[key], newValue: value };
            store[key] = structuredClone(value);
          }
          changeListeners.forEach(listener => listener(changes, 'local'));
          callback && callback();
        }
      },
      onChanged: { addListener: listener => changeListeners.push(listener) }
    },
    runtime: { lastError: undefined }
  };

  const fetchCalls = [];
  const fakeFetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    if (!fetch) throw new Error(`unexpected fetch: ${url}`);
    return fetch(String(url), init);
  };

  const context = vm.createContext({
    chrome,
    fetch: fakeFetch,
    console,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    URL,
    structuredClone,
    AbortSignal,
    AbortController,
    // 本地快取用記憶體假裝一下
    TranslationCache: {
      async getTranslation(text, lang) { return diskCache.get(`${text}_${lang}`) ?? null; },
      async setTranslation(text, translated, lang) { diskCache.set(`${text}_${lang}`, translated); },
      async getCacheSize() { return `${diskCache.size} entries`; },
      async clearCache() { diskCache.clear(); }
    }
  });

  for (const file of LIBS) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  }

  return { context, chrome, store, fetchCalls, diskCache };
}

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

// 假的 OpenAI 相容回覆
export const chatResponse = content => jsonResponse({ choices: [{ message: { content } }] });
