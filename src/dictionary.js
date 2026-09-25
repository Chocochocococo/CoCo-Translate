// dictionary.js — 查單字：英文單字附上音標與英英解釋（免費的 dictionaryapi.dev，不用金鑰）
"use strict";

const Dictionary = (() => {
  const cache = new Map();
  const API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const TIMEOUT_MS = 8000;

  const isEnglishWord = word => /^[A-Za-z][A-Za-z'-]{0,40}$/.test(word);

  /**
   * @param {string} word
   * @param {number} [timeoutMs] 最多等多久（毫秒）
   * @returns {Promise<{phonetic: string, meanings: {partOfSpeech: string, definition: string}[]}|null>}
   *   不是英文單字、查不到、連不上都回傳 null（單字卡照樣顯示譯文）
   */
  const lookup = async (word, timeoutMs = TIMEOUT_MS) => {
    if (!isEnglishWord(word)) return null;
    const key = word.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    let result = null;
    try {
      // dictionaryapi.dev 偶爾會卡住不回，幹，最多等 8 秒
      const response = await fetch(API + encodeURIComponent(key), { signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const [entry] = await response.json();
        const phonetic = entry?.phonetic || entry?.phonetics?.find(p => p.text)?.text || '';
        const meanings = (entry?.meanings || [])
          .map(m => ({ partOfSpeech: m.partOfSpeech || '', definition: m.definitions?.[0]?.definition || '' }))
          .filter(m => m.definition)
          .slice(0, 3);
        result = phonetic || meanings.length ? { phonetic, meanings } : null;
      }
    } catch (error) {
      console.warn('Dictionary lookup failed:', error);
      return null;   // 連線失敗不快取，下次再試
    }
    cache.set(key, result);
    return result;
  };

  return { lookup, isEnglishWord };
})();

globalThis.Dictionary = Dictionary;
