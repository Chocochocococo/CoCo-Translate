// captions.js — YouTube 字幕檔（json3）→ 一句一句的完整句子
// 畫面上的 CC 是一邊播一邊冒字，句子被切成好幾段；直接讀整份字幕檔，才能整句翻譯、整句顯示
"use strict";

const Captions = (() => {
  const MAX_GAP_MS = 1500;       // 停頓超過這麼久就當作新的一句
  const MAX_WORDS = 32;          // 一直沒有句號的自動字幕，最多這麼多字就硬切
  const SOFT_WORDS = 20;         // 超過這麼多字、剛好遇到逗號就切
  const MAX_CJK_CHARS = 60;
  const MAX_DURATION_MS = 12000;
  const LINGER_MS = 1500;        // 說完之後字幕多留一下，別一講完就消失
  const SENTENCE_END = /[.!?。！？…]["'”’」』)\]]*$/;
  const SOFT_END = /[,;:，、；：]$/;
  const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;

  const clean = text => String(text || '').replace(/​/g, '').replace(/\s*\n\s*/g, ' ');

  /**
   * json3 字幕檔 → 一段一段有時間的文字
   * 手動字幕：一個 event 一段；自動字幕：一個字一段（segs 有 tOffsetMs）
   * @returns {{text: string, start: number, end: number}[]}
   */
  const parseJson3 = data => {
    const units = [];
    (data?.events || []).forEach(event => {
      if (!Array.isArray(event.segs)) return;
      const start = event.tStartMs || 0;
      const end = start + (event.dDurationMs || 0);
      const wordLevel = event.segs.length > 1 && event.segs.some(seg => seg.tOffsetMs !== undefined);
      if (wordLevel) {
        event.segs.forEach(seg => {
          const text = clean(seg.utf8);
          if (text.trim()) units.push({ text, start: start + (seg.tOffsetMs || 0), end });
        });
      } else {
        const text = clean(event.segs.map(seg => seg.utf8 || '').join('')).trim();
        if (text) units.push({ text, start, end });
      }
    });
    units.sort((a, b) => a.start - b.start);
    // 自動字幕的 event 會重疊（滾動顯示），一個字的結束時間＝下一個字開始
    units.forEach((unit, i) => {
      const next = units[i + 1];
      if (next && next.start < unit.end) unit.end = Math.max(unit.start + 1, next.start);
    });
    return units;
  };

  // 接起來：英文要空格，中日韓不用
  const join = (left, right) => {
    if (!left) return right.trim();
    if (/^\s/.test(right)) return left + right.replace(/^\s+/, ' ');
    if (CJK.test(left.slice(-1)) && CJK.test(right.trim().charAt(0))) return left + right.trim();
    return `${left} ${right.trim()}`;
  };

  const wordCount = text => text.split(/\s+/).filter(Boolean).length;
  const cjkCount = text => (text.match(new RegExp(CJK.source, 'g')) || []).length;

  /**
   * 一段一段的文字 → 完整的句子：遇到句號、停頓太久、太長就切
   * @returns {{text: string, start: number, end: number, displayEnd: number}[]}
   */
  const buildSentences = units => {
    const sentences = [];
    let current = null;
    const flush = () => {
      if (current && current.text.trim()) sentences.push({ ...current, text: current.text.replace(/\s+/g, ' ').trim() });
      current = null;
    };
    units.forEach(unit => {
      if (current && unit.start - current.end > MAX_GAP_MS) flush();
      if (!current) current = { text: '', start: unit.start, end: unit.end };
      current.text = join(current.text, unit.text);
      current.end = Math.max(current.end, unit.end);

      const text = current.text.trim();
      const words = wordCount(text);
      const cjk = cjkCount(text);
      if (SENTENCE_END.test(text)) return flush();
      if (words >= MAX_WORDS || cjk >= MAX_CJK_CHARS || current.end - current.start >= MAX_DURATION_MS) return flush();
      if ((words >= SOFT_WORDS || cjk >= MAX_CJK_CHARS * 0.6) && SOFT_END.test(text)) flush();
    });
    flush();

    // 顯示到下一句開始為止（最多多留 LINGER_MS）
    sentences.forEach((sentence, i) => {
      const next = sentences[i + 1];
      sentence.end = next ? Math.min(sentence.end, next.start) : sentence.end;
      sentence.displayEnd = next ? Math.min(next.start, sentence.end + LINGER_MS) : sentence.end + LINGER_MS;
    });
    return sentences;
  };

  /**
   * 現在（毫秒）該顯示哪一句；沒有就回傳 -1
   */
  const findIndex = (sentences, timeMs) => {
    let low = 0;
    let high = sentences.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sentences[mid].start <= timeMs) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found >= 0 && timeMs < sentences[found].displayEnd ? found : -1;
  };

  /**
   * 播放器自己下載字幕檔的網址 → 我們要重新下載的網址
   * 一律要 json3 格式；拿掉 tlang（YouTube 自己的自動翻譯），我們要原文
   * @returns {{url: string, key: string, videoId: string, lang: string}|null}
   */
  const normalizeTrackUrl = (url, base = 'https://www.youtube.com/') => {
    let parsed;
    try {
      parsed = new URL(url, base);
    } catch (e) {
      return null;
    }
    if (!parsed.pathname.endsWith('/api/timedtext')) return null;
    const videoId = parsed.searchParams.get('v') || '';
    if (!videoId) return null;
    parsed.searchParams.set('fmt', 'json3');
    parsed.searchParams.delete('tlang');
    const lang = parsed.searchParams.get('lang') || '';
    const key = [videoId, lang, parsed.searchParams.get('kind') || '', parsed.searchParams.get('name') || ''].join('|');
    return { url: parsed.toString(), key, videoId, lang };
  };

  return { parseJson3, buildSentences, findIndex, normalizeTrackUrl };
})();

globalThis.Captions = Captions;
