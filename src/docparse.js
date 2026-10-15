// docparse.js — 文件翻譯用：把 PDF 的文字、TXT 檔整理成一段一段的段落
// PDF 裡沒有「段落」，只有「這幾個字放在這個座標」；這裡把它們拼回人看得懂的段落，翻譯才通順
"use strict";

const DocParse = (() => {
  const CJK = /[぀-ヿ㐀-鿿가-힯豈-﫿＀-￯]/;
  const SENTENCE_END = /[.!?。！？…:：]["'”’」』)\]）]*$/;
  // 項目符號、編號開頭的一行一定是新的一段：•、-、1.、(1)、①、一、、Step 3
  const BULLET = /^(?:[•●○◦▪■□◆◇▶►‣⁃\-–—*・]\s*|\(?\d{1,3}[.)、]\s*|[(（]\d{1,3}[)）]\s*|[①-⑳]|[一二三四五六七八九十]+、|step\s*\d+)/i;
  // 頁首頁尾的頁碼：12、- 12 -、Page 3 of 10、3 / 10、第 3 頁
  const PAGE_NUMBER = /^(?:[-–—\s]*(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?[-–—\s]*|第\s*\d{1,4}\s*頁(?:\s*[/／共]\s*\d{1,4}\s*頁?)?)$/i;

  // 字比內文大 15% 以上就當標題（11pt 內文配 13pt 小標也算）
  const HEADING_RATIO = 1.15;

  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const isCJK = char => !!char && CJK.test(char);

  // 兩段文字接起來：英文斷字的連字號要拿掉、英文要空格、中日韓不用
  const joinText = (left, right) => {
    if (!left) return right;
    if (!right) return left;
    const last = left.slice(-1);
    const first = right.charAt(0);
    if (/[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)) return left.slice(0, -1) + right;
    if (isCJK(last) || isCJK(first)) return left + right;
    return `${left} ${right}`;
  };

  /**
   * pdf.js 的 getTextContent() 項目 → 一行一行
   * @param {{str: string, transform: number[], width: number, height: number, hasEOL?: boolean}[]} items
   * @returns {{text: string, x: number, y: number, right: number, size: number}[]}
   */
  const linesFromItems = items => {
    const lines = [];
    let current = null;
    const push = () => {
      if (current && current.text.trim()) lines.push({ ...current, text: current.text.replace(/\s+/g, ' ').trim() });
      current = null;
    };
    for (const item of items || []) {
      const [, , c, d, x, y] = item.transform || [0, 0, 0, 0, 0, 0];
      const size = Math.abs(d) || Math.hypot(c, d) || item.height || 10;
      // 換行：y 座標差超過半個字高（PDF 的 y 往上增加）
      if (current && Math.abs(y - current.y) > Math.min(size, current.size) * 0.5) push();
      const str = item.str || '';
      if (str) {
        if (!current) current = { text: '', x, y, right: x, size };
        const gap = x - current.right;
        const needsSpace = current.text && !/\s$/.test(current.text) && !/^\s/.test(str) &&
          (isCJK(current.text.slice(-1)) && isCJK(str.charAt(0)) ? gap > size * 0.8 : gap > size * 0.15);
        current.text += (needsSpace ? ' ' : '') + str;
        current.right = Math.max(current.right, x + (item.width || 0));
        current.size = Math.max(current.size, size);
      }
      if (item.hasEOL) push();
    }
    push();
    return lines;
  };

  // 頁首頁尾：同一個位置、同樣的字
  const exactKey = line => `${Math.round((line.y || 0) / 4)}|${line.text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  // 數字不算的版本（「Page 3 · 使用手冊」「Chapter 2 – Safety」）。只用在短的、看起來像頁首的行，
  // 不然「Section 1 …」「- Unplug part 2 …」這種內文也會被當成頁首砍掉
  const maskedKey = line => exactKey(line).replace(/\d+/g, '#');

  /**
   * 拿掉頁首、頁尾、頁碼：每頁最上面、最下面兩行，在大部分頁面都出現的就是頁首頁尾
   * @param {Array<Array<{text: string, y: number, size: number}>>} pages 每頁的行（由上到下）
   */
  const removeRepeatedEdges = pages => {
    const edgesOf = lines => [...new Set([...lines.slice(0, 2), ...lines.slice(-2)])];
    const exactCounts = new Map();
    const maskedCounts = new Map();
    const count = (map, keys) => new Set(keys).forEach(key => map.set(key, (map.get(key) || 0) + 1));
    pages.forEach(lines => {
      count(exactCounts, edgesOf(lines).map(exactKey));
      count(maskedCounts, edgesOf(lines).map(maskedKey));
    });
    const threshold = Math.max(2, Math.ceil(pages.length * 0.6));
    const bodySize = median(pages.flat().map(line => line.size));
    // 頁首頁尾通常字比較小，或是跟內文隔一段距離
    const looksLikeEdge = (line, lines) => {
      if (line.size < bodySize * 0.95) return true;
      const i = lines.indexOf(line);
      const inner = i < lines.length / 2 ? lines[i + 1] : lines[i - 1];
      return !inner || Math.abs(inner.y - line.y) > Math.max(line.size, inner.size) * 2;
    };
    return pages.map(lines => {
      const edges = new Set(edgesOf(lines));
      return lines.filter(line => {
        if (!edges.has(line)) return true;
        if (PAGE_NUMBER.test(line.text.trim())) return false;
        // 比內文大的是每頁開頭的標題（Chapter 1、Chapter 2…），不是頁首
        if (pages.length < 2 || line.size > bodySize * HEADING_RATIO) return true;
        if ((exactCounts.get(exactKey(line)) || 0) >= threshold) return false;
        const text = line.text.trim();
        return !(text.length <= 60 && /\d/.test(text) && (maskedCounts.get(maskedKey(line)) || 0) >= threshold && looksLikeEdge(line, lines));
      });
    });
  };

  /**
   * 一頁的行 → 段落
   * 新的一段：行距突然變大、字級變了（標題）、項目符號開頭、上一行是句尾又比較短
   * @returns {{text: string, heading: boolean}[]}
   */
  const paragraphsFromLines = (lines, { bodySize } = {}) => {
    if (!lines.length) return [];
    const sizes = lines.map(line => line.size);
    const typicalSize = bodySize || median(sizes);
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const gap = lines[i - 1].y - lines[i].y;
      if (gap > 0 && gap < typicalSize * 3) gaps.push(gap);
    }
    const lineGap = median(gaps) || typicalSize * 1.2;
    const rightEdge = median(lines.map(line => line.right).filter(right => right > 0)) || 0;
    const isHeading = line => line.size > typicalSize * HEADING_RATIO;

    const paragraphs = [];
    let current = null;
    lines.forEach((line, i) => {
      const prev = lines[i - 1];
      let startNew = !current;
      if (current && prev) {
        const gap = prev.y - line.y;
        const sizeChanged = Math.abs(line.size - prev.size) > typicalSize * 0.15;
        const shortSentenceEnd = SENTENCE_END.test(prev.text) && rightEdge && prev.right < rightEdge - typicalSize * 2;
        startNew = gap > lineGap * 1.4 || gap < -typicalSize || sizeChanged || BULLET.test(line.text) || shortSentenceEnd;
      }
      if (startNew) {
        current = { text: line.text, heading: isHeading(line) };
        paragraphs.push(current);
      } else {
        current.text = joinText(current.text, line.text);
      }
    });
    return paragraphs;
  };

  /**
   * 整份 PDF：每頁的 getTextContent() 項目 → 每頁的段落
   * @param {Array<Array<Object>>} pagesItems
   * @returns {Array<Array<{text: string, heading: boolean}>>}
   */
  const paragraphsFromPdfPages = pagesItems => {
    const pages = removeRepeatedEdges(pagesItems.map(linesFromItems));
    // 整份文件的內文字級，標題判斷才不會因為某一頁都是標題而失準
    const bodySize = median(pages.flat().map(line => line.size));
    return pages.map(lines => paragraphsFromLines(lines, { bodySize }));
  };

  /**
   * TXT 檔 → 段落：空行分段；英文排版時自動折行的一段會接回來，詩、清單這種短行保留換行
   * @returns {{text: string, heading: boolean}[]}
   */
  const paragraphsFromText = text => String(text || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t　]*\n+/)
    .map(block => {
      const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
      if (lines.length <= 1) return lines.join('');
      const average = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
      const cjk = lines.some(line => CJK.test(line));
      const wrapped = cjk ? average >= 25 : average >= 50;
      return wrapped ? lines.reduce(joinText, '') : lines.join('\n');
    })
    .filter(paragraph => paragraph.trim())
    .map(paragraph => ({ text: paragraph, heading: false }));

  /**
   * 文字檔的編碼：BOM → UTF-8 → 台灣、中國、日本、韓國常見的舊編碼，挑亂碼最少的
   * @param {Uint8Array} bytes
   */
  const decodeText = bytes => {
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      // 不是 UTF-8，換舊編碼試試
    }
    let best = null;
    for (const label of ['big5', 'gb18030', 'shift_jis', 'euc-kr']) {
      try {
        const text = new TextDecoder(label).decode(bytes);
        const broken = (text.match(/�/g) || []).length;
        if (!best || broken < best.broken) best = { text, broken };
      } catch (e) {
        // 瀏覽器不支援這個編碼
      }
    }
    return best ? best.text : new TextDecoder('utf-8').decode(bytes);
  };

  return { linesFromItems, removeRepeatedEdges, paragraphsFromLines, paragraphsFromPdfPages, paragraphsFromText, decodeText, joinText };
})();

globalThis.DocParse = DocParse;
