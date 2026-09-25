// markup.js — 段落翻譯用的行內標記（content script 與 background 共用）
//
// 一整段連同行內樣式一起送出，行內元素換成帶 id 的標準 HTML 標籤：
//   He said <b id="g0">hello</b> to <i id="g1">her</i>.
//   Look <img id="x2"> here          ← 圖片、表單元件等「不翻的東西」
// 翻譯服務（Google / Bing / DeepL / AI）會照目標語言的語序移動標籤，
// 回來後再依 id 對回原本的元素。
"use strict";

const Markup = (() => {
  const escapeText = text => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const decodeEntities = text => text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  const TAG_PATTERN = /<(\/?)([a-zA-Z][\w-]*)([^<>]*?)(\/?)>/g;
  const VOID_TAGS = new Set(['img', 'br', 'wbr', 'input', 'hr']);

  // HTML 模式會把換行當空白吃掉，送出前換成 <br>，回來再換回去
  const newlinesToBr = html => html.replace(/\n/g, '<br>');
  const brToNewlines = html => html.replace(/<br\s*\/?>/gi, '\n');

  const stripTags = html => decodeEntities(html.replace(TAG_PATTERN, ''));

  /**
   * 解析翻譯回來的標記 → 樹狀結構；格式壞掉就回傳 null
   * 節點：{ type: 'text', text } | { type: 'el', id: 'g0' | 'x1', children: [] }
   */
  const parse = html => {
    const root = { type: 'root', children: [] };
    const stack = [{ node: root, tag: null }];
    let last = 0;
    const pushText = raw => {
      if (!raw) return;
      const text = decodeEntities(raw);
      const children = stack[stack.length - 1].node.children;
      const prev = children[children.length - 1];
      if (prev && prev.type === 'text') prev.text += text;
      else children.push({ type: 'text', text });
    };

    for (const match of html.matchAll(TAG_PATTERN)) {
      pushText(html.slice(last, match.index));
      last = match.index + match[0].length;
      const [, closing, rawTag, attrs, selfClosing] = match;
      const tag = rawTag.toLowerCase();

      if (tag === 'br') {
        pushText('\n');
        continue;
      }
      if (closing) {
        // AI 偶爾會寫出 <img id="x0"></img>，void 元素的結尾標籤直接忽略
        if (VOID_TAGS.has(tag)) continue;
        const top = stack[stack.length - 1];
        if (stack.length === 1 || top.tag !== tag) return null;
        stack.pop();
        continue;
      }
      const idMatch = attrs.match(/\bid\s*=\s*["']?([gx]\d+)["']?/);
      if (!idMatch) return null;                    // 翻譯服務自己加的標籤，對不回去
      const node = { type: 'el', id: idMatch[1], children: [] };
      stack[stack.length - 1].node.children.push(node);
      if (!selfClosing && !VOID_TAGS.has(tag)) stack.push({ node, tag });
    }
    pushText(html.slice(last));
    if (stack.length !== 1) return null;
    return root;
  };

  /**
   * 檢查翻譯回來的結構能不能安全地套回原本的 DOM：
   * 每個 id 剛好出現一次、父子關係不變、不翻的東西（x）裡面沒有文字
   * @param {Object} tree parse() 的結果
   * @param {Object<string, string|null>} expectedParents id → 父元素 id（最外層為 null）
   */
  const matchesStructure = (tree, expectedParents) => {
    if (!tree) return false;
    const seen = new Set();
    let ok = true;
    const walk = (node, parentId) => {
      for (const child of node.children) {
        if (child.type !== 'el') continue;
        if (seen.has(child.id) || !(child.id in expectedParents) || expectedParents[child.id] !== parentId) {
          ok = false;
          return;
        }
        if (child.id[0] === 'x' && child.children.length) {
          ok = false;
          return;
        }
        seen.add(child.id);
        walk(child, child.id);
      }
    };
    walk(tree, null);
    return ok && seen.size === Object.keys(expectedParents).length;
  };

  /**
   * 後處理（自訂正規表達式、引號轉換）時把標籤藏起來，只動文字：
   * 標籤換成私用區字元，文字解碼成一般字串
   */
  const PUA_START = 0xe000;
  const protect = html => {
    const tags = [];
    const text = html.replace(TAG_PATTERN, tag => {
      tags.push(tag);
      return String.fromCharCode(PUA_START + tags.length - 1);
    });
    return { text: decodeEntities(text), tags };
  };

  const restore = ({ text, tags }) => {
    let result = '';
    for (const char of text) {
      const index = char.charCodeAt(0) - PUA_START;
      result += index >= 0 && index < tags.length ? tags[index] : escapeText(char);
    }
    return result;
  };

  return { escapeText, decodeEntities, stripTags, parse, matchesStructure, protect, restore, newlinesToBr, brToNewlines };
})();

globalThis.Markup = Markup;
