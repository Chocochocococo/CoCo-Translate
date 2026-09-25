// glossary.js — 術語表：讓人名、專有名詞每次都翻成同一個譯名（background 用）
//
// 詞條：{ source: 'Lin Feng', target: '林楓', site: '' }
//   site 留空＝所有網站，也可以填網站規則（見 sitePatterns.js），例如 *.novel-site.com
//
// AI 翻譯：把這批文字裡有出現的詞條寫進 prompt
// Google / Bing / DeepL / Cloud：送出前先把原文換成譯名，並標成不翻譯：
//   Lin Feng looked at her → <span class="notranslate" id="t0">林楓</span> looked at her
// 翻譯服務會把它當成固定詞排進句子裡，回來再把標記拿掉
"use strict";

const Glossary = (() => {
  const TAG_PATTERN = /<[^<>]+>/g;

  const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 這個網站適用的詞條
  const active = (entries, pageUrl) => (entries || []).filter(entry =>
    entry && entry.source && entry.target &&
    (!entry.site || (pageUrl && SitePatterns.matches(entry.site, pageUrl)))
  );

  // 詞條內容的指紋（快取 key 用）：術語表改了，快取就自動換一份
  const signature = entries => {
    if (!entries.length) return '';
    const text = entries.map(e => `${e.source}\u0000${e.target}`).sort().join('\u0001');
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
    return hash.toString(36);
  };

  /**
   * 比對用的正規表達式：長的詞條優先（"Lin Feng" 比 "Lin" 先配對）；
   * 英數字開頭／結尾的詞條要求前後不是英數字，免得 "Lin" 把 "Linda" 吃掉
   */
  const buildMatcher = (entries, escapeSource) => {
    const sorted = [...entries].sort((a, b) => b.source.length - a.source.length);
    const parts = sorted.map(entry => {
      const source = escapeSource ? escapeSource(entry.source) : entry.source;
      const before = /^[A-Za-z0-9]/.test(entry.source) ? '(?<![A-Za-z0-9])' : '';
      const after = /[A-Za-z0-9]$/.test(entry.source) ? '(?![A-Za-z0-9])' : '';
      return `${before}${escapeRegExp(source)}${after}`;
    });
    return parts.length ? new RegExp(parts.join('|'), 'g') : null;
  };

  // 這批文字裡實際出現的詞條
  const used = (entries, texts) => {
    const matcher = buildMatcher(entries);
    if (!matcher) return [];
    const found = new Set();
    for (const text of texts) {
      for (const match of text.matchAll(matcher)) found.add(match[0]);
    }
    return entries.filter(entry => found.has(entry.source));
  };

  // 給 AI 的說明
  const promptFor = entries => entries.length
    ? '\n\nGlossary — always translate these terms exactly as given (this overrides any other instruction about names):\n' +
      entries.map(entry => `- ${entry.source} → ${entry.target}`).join('\n')
    : '';

  /**
   * 在 HTML 標記的「文字部分」把原文換成譯名並標成不翻譯
   * @param {string} html 已跳脫的 HTML（見 markup.js）
   * @returns {string}
   */
  const wrapTerms = (html, entries) => {
    const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const matcher = buildMatcher(entries, escape);
    if (!matcher) return html;
    const targets = new Map(entries.map(entry => [escape(entry.source), escape(entry.target)]));
    let index = 0;
    let result = '';
    let last = 0;
    const wrapText = text => text.replace(matcher, match =>
      `<span class="notranslate" translate="no" id="t${index++}">${targets.get(match)}</span>`);
    for (const tag of html.matchAll(TAG_PATTERN)) {
      result += wrapText(html.slice(last, tag.index)) + tag[0];
      last = tag.index + tag[0].length;
    }
    return result + wrapText(html.slice(last));
  };

  // 拿掉不翻譯標記，只留下譯名
  const unwrapTerms = html => html.replace(/<span\b[^>]*\bid=["']?t\d+["']?[^>]*>([\s\S]*?)<\/span>/g, '$1');

  return { active, signature, used, promptFor, wrapTerms, unwrapTerms };
})();

globalThis.Glossary = Glossary;
