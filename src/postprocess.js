// postprocess.js — 譯文後處理：自訂正規表達式、引號轉換、清掉 LLM 的多餘輸出
// 在 background 執行，同一份規則套用到所有翻譯來源
"use strict";

const PostProcess = (() => {
  // 這些語言不把引號換成「」
  const KEEP_QUOTES_LANGS = ['en', 'ko'];

  let regexConfigPromise = null;

  const loadRegexConfig = () => new Promise(resolve => {
    chrome.storage.local.get(['enableCustomRegex', 'regexPatterns'], data => {
      if (data.enableCustomRegex === false) return resolve([]);
      const compiled = [];
      (data.regexPatterns || []).forEach(pattern => {
        if (!pattern || !pattern.enabled || !pattern.input) return;
        try {
          compiled.push({ regex: new RegExp(pattern.input, 'g'), output: pattern.output ?? '' });
        } catch (e) {
          console.error('Invalid regex pattern:', pattern.input, e);
        }
      });
      resolve(compiled);
    });
  });

  // 規則有變就重新編譯，別每段譯文都去 storage 撈一次
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('enableCustomRegex' in changes || 'regexPatterns' in changes)) {
      regexConfigPromise = null;
    }
  });

  const getRegexConfig = () => (regexConfigPromise ??= loadRegexConfig());

  const applyRegexPatterns = (text, compiled) =>
    compiled.reduce((result, { regex, output }) => result.replace(regex, output), text);

  const convertQuotes = (text, targetLang) => {
    if (KEEP_QUOTES_LANGS.includes((targetLang || '').toLowerCase())) return text;
    return text
      .replace(/["“”](.+?)["”]/g, '「$1」')
      .replace(/[“](.+?)[」]/g, '「$1」')
      .replace(/[「](.+?)[”]/g, '「$1」')
      .replace(/”/g, '」')
      .replace(/“/g, '「');
  };

  // LLM 有時候會多吐思考過程、Markdown 圍欄或開場白，全部砍掉
  const cleanLLMOutput = text => text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .replace(/^The following is the translated content:\s*/i, '')
    .trim();

  const decodeHtmlEntities = text => text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  const escapeHtml = text => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  /**
   * 對一批原始譯文做後處理
   * @param {string[]} texts
   * @param {string} targetLang
   * @returns {Promise<string[]>}
   */
  const apply = async (texts, targetLang) => {
    const compiled = await getRegexConfig();
    return texts.map(text => convertQuotes(applyRegexPatterns(text, compiled), targetLang));
  };

  return { apply, convertQuotes, cleanLLMOutput, decodeHtmlEntities, escapeHtml, applyRegexPatterns };
})();

globalThis.PostProcess = PostProcess;
