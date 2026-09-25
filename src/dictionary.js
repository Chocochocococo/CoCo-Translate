// dictionary.js — 查單字：像真的字典一樣列出每個詞性的多個意思
//   雙語詞典：Google 翻譯網站自己用的字典資料（免金鑰；英、日、韓……都查得到，翻成目標語言）
//   英英解釋：Free Dictionary API（dictionaryapi.dev，資料來自維基詞典，免金鑰，只有英文）
// 兩邊同時查，哪邊有就顯示哪邊；都查不到就回傳 null（單字卡照樣顯示譯文）
"use strict";

const Dictionary = (() => {
  const cache = new Map();
  const GOOGLE_API = 'https://translate.googleapis.com/translate_a/single';
  const FREE_DICTIONARY_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  const TIMEOUT_MS = 8000;
  const MAX_TERMS = 8;          // 每個詞性最多列幾個中文意思
  const MAX_DEFINITIONS = 3;    // 每個詞性最多幾條英英解釋
  const MAX_PARTS = 5;          // 最多幾個詞性

  const isEnglishWord = word => /^[A-Za-z][A-Za-z'-]{0,40}$/.test(word);
  // 字典只查單字或短片語，整句話就只要譯文
  const isLookupable = text => text.length <= 50 && text.split(/\s+/).length <= 5;

  const fetchJson = async (url, timeoutMs) => {
    // 字典伺服器偶爾會卡住不回，幹，最多等 timeoutMs
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  // ---------------- Google 雙語詞典 ----------------
  // dt=bd：依詞性分組的譯詞；dt=md：英英解釋；dt=rm：音標（拼音）；dj=1：回傳有欄位名稱的 JSON
  const googleUrl = (word, targetLang) => {
    const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: targetLang, hl: targetLang, dj: '1', q: word });
    return `${GOOGLE_API}?${params}&dt=t&dt=bd&dt=md&dt=rm`;
  };

  const parseGoogle = data => {
    const bilingual = (Array.isArray(data?.dict) ? data.dict : [])
      .map(group => {
        // entry 已經照常用程度排好；舊格式只有 terms
        const fromEntries = (group.entry || []).map(entry => entry.word);
        const terms = [...new Set((fromEntries.length ? fromEntries : group.terms || []).filter(Boolean))];
        return { pos: group.pos || '', terms: terms.slice(0, MAX_TERMS) };
      })
      .filter(group => group.terms.length)
      .slice(0, MAX_PARTS);

    const definitions = (Array.isArray(data?.definitions) ? data.definitions : [])
      .map(group => ({
        pos: group.pos || '',
        items: (group.entry || [])
          .filter(entry => entry.gloss)
          .slice(0, MAX_DEFINITIONS)
          .map(entry => ({ definition: entry.gloss, example: entry.example || '' }))
      }))
      .filter(group => group.items.length)
      .slice(0, MAX_PARTS);

    const translit = (data?.sentences || []).find(sentence => sentence.src_translit)?.src_translit || '';
    return { bilingual, definitions, phonetic: translit, sourceLang: data?.src || '' };
  };

  const lookupGoogle = async (word, targetLang, timeoutMs) => {
    try {
      return parseGoogle(await fetchJson(googleUrl(word, targetLang), timeoutMs));
    } catch (error) {
      console.warn('Google dictionary lookup failed:', error);
      return null;
    }
  };

  // ---------------- Free Dictionary（英英） ----------------
  const parseFreeDictionary = entries => {
    const list = Array.isArray(entries) ? entries : [];
    const phonetic = list.map(entry => entry.phonetic || entry.phonetics?.find(p => p.text)?.text).find(Boolean) || '';
    // 同一個字可能有好幾筆（不同字源），同詞性的解釋合在一起
    const byPos = new Map();
    list.forEach(entry => (entry.meanings || []).forEach(meaning => {
      const pos = meaning.partOfSpeech || '';
      const items = byPos.get(pos) || [];
      (meaning.definitions || []).forEach(def => {
        if (def.definition && items.length < MAX_DEFINITIONS) {
          items.push({ definition: def.definition, example: def.example || '' });
        }
      });
      byPos.set(pos, items);
    }));
    const definitions = [...byPos.entries()]
      .map(([pos, items]) => ({ pos, items }))
      .filter(group => group.items.length)
      .slice(0, MAX_PARTS);
    return { phonetic, definitions };
  };

  const lookupFreeDictionary = async (word, timeoutMs) => {
    if (!isEnglishWord(word)) return null;
    try {
      return parseFreeDictionary(await fetchJson(FREE_DICTIONARY_API + encodeURIComponent(word.toLowerCase()), timeoutMs));
    } catch (error) {
      // 404＝查不到這個字，也是走這裡
      return null;
    }
  };

  /**
   * @param {string} word
   * @param {string} [targetLang] 雙語詞典要翻成的語言
   * @param {number} [timeoutMs] 每個來源最多等多久（毫秒）
   * @returns {Promise<{
   *   phonetic: string,
   *   bilingual: {pos: string, terms: string[]}[],
   *   definitions: {pos: string, items: {definition: string, example: string}[]}[],
   *   meanings: {partOfSpeech: string, definition: string}[]
   * }|null>}
   */
  const lookup = async (word, targetLang = 'zh-TW', timeoutMs = TIMEOUT_MS) => {
    const text = String(word || '').trim();
    if (!text || !isLookupable(text)) return null;
    const key = `${text.toLowerCase()}\u0000${targetLang}`;
    if (cache.has(key)) return cache.get(key);

    const [google, free] = await Promise.all([
      lookupGoogle(text, targetLang, timeoutMs),
      lookupFreeDictionary(text, timeoutMs)
    ]);
    // 兩邊都連不上：不快取，下次再試
    if (!google && !free) return null;

    // 英英解釋：Free Dictionary 有例句、比較完整，優先用；沒有才用 Google 的
    const definitions = free?.definitions?.length ? free.definitions : google?.definitions || [];
    const result = {
      // IPA 音標優先（Free Dictionary），Google 的是拼讀標示
      phonetic: free?.phonetic || google?.phonetic || '',
      bilingual: google?.bilingual || [],
      definitions,
      // 舊版的欄位：每個詞性第一條解釋（生字本、舊程式用）
      meanings: definitions.map(group => ({ partOfSpeech: group.pos, definition: group.items[0].definition }))
    };
    const empty = !result.phonetic && !result.bilingual.length && !result.definitions.length;
    cache.set(key, empty ? null : result);
    return empty ? null : result;
  };

  return { lookup, isEnglishWord, parseGoogle, parseFreeDictionary };
})();

globalThis.Dictionary = Dictionary;
