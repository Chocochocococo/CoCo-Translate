// docformats.js — 文件翻譯用：Word（.docx）、EPUB、字幕檔（.srt、.vtt）拆成段落
// DOCX、EPUB 其實都是 zip 包著 XML，用瀏覽器內建的 DecompressionStream 解壓，不用再塞一個 zip 函式庫
"use strict";

const DocFormats = (() => {
  // ---------------- zip ----------------
  /**
   * 讀 zip 的目錄（不支援 zip64 和加密，DOCX、EPUB 用不到）
   * @param {Uint8Array} bytes
   */
  const readZip = bytes => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip file');
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const entries = new Map();
    const utf8 = new TextDecoder('utf-8');
    for (let n = 0; n < count && view.getUint32(offset, true) === 0x02014b50; n++) {
      const nameLength = view.getUint16(offset + 28, true);
      const name = utf8.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      entries.set(name, {
        method: view.getUint16(offset + 10, true),
        size: view.getUint32(offset + 20, true),
        local: view.getUint32(offset + 42, true)
      });
      offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    // EPUB 的連結偶爾大小寫跟檔名對不上
    const lower = new Map([...entries.keys()].map(name => [name.toLowerCase(), name]));
    const find = name => entries.get(name) || entries.get(lower.get(String(name).toLowerCase()));

    const read = async name => {
      const entry = find(name);
      if (!entry) return null;
      const start = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
      const data = bytes.subarray(start, start + entry.size);
      if (entry.method === 0) return data;
      if (entry.method !== 8) throw new Error(`unsupported zip compression (${entry.method})`);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    const readText = async name => {
      const data = await read(name);
      return data && new TextDecoder('utf-8').decode(data);
    };
    return { names: [...entries.keys()], has: name => !!find(name), read, readText };
  };

  const isZip = bytes => bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  const parseXml = (text, type = 'application/xml') => {
    const doc = new DOMParser().parseFromString(text, type);
    if (doc.getElementsByTagName('parsererror').length && type !== 'text/html') {
      // XHTML 寫壞的電子書不少，用 HTML 的寬鬆模式再讀一次
      return new DOMParser().parseFromString(text, 'text/html');
    }
    return doc;
  };

  const tidy = text => text
    .split('\n')
    .map(line => line.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  // ---------------- Word（.docx） ----------------
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const wAttr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute(`w:${name}`) ?? null;
  const wChild = (el, name) => [...(el?.childNodes || [])].find(node => node.localName === name && node.namespaceURI === W) || null;

  /**
   * @param {Uint8Array} bytes
   * @returns {Promise<{title: string, items: {text: string, heading: boolean}[]}>}
   */
  const parseDocx = async bytes => {
    const zip = readZip(bytes);
    const xml = await zip.readText('word/document.xml');
    if (!xml) throw new Error('word/document.xml not found');
    const doc = parseXml(xml);

    // 樣式表裡的名稱一律是英文（heading 1、Title），中文版 Word 的樣式 ID 卻可能只是「1」
    const headingStyles = new Set();
    const stylesXml = await zip.readText('word/styles.xml');
    if (stylesXml) {
      for (const style of parseXml(stylesXml).getElementsByTagNameNS(W, 'style')) {
        const name = wAttr(wChild(style, 'name'), 'val') || '';
        const outline = wChild(wChild(style, 'pPr'), 'outlineLvl');
        if (/^(heading|title|subtitle)\b/i.test(name) || outline) headingStyles.add(wAttr(style, 'styleId'));
      }
    }

    const items = [];
    const textOf = paragraph => {
      let text = '';
      const walk = node => {
        for (const child of node.childNodes) {
          if (child.nodeType !== 1) continue;
          if (child.namespaceURI === W) {
            const name = child.localName;
            if (name === 'p') continue;   // 文字方塊裡的段落另外算
            if (name === 't') { text += child.textContent; continue; }
            if (name === 'tab') { text += '\t'; continue; }
            if (name === 'br' || name === 'cr') { text += '\n'; continue; }
            if (name === 'noBreakHyphen') { text += '-'; continue; }
            if (name === 'delText' || name === 'instrText' || name === 'pPr' || name === 'rPr') continue;
          }
          walk(child);
        }
      };
      walk(paragraph);
      return tidy(text);
    };

    for (const paragraph of doc.getElementsByTagNameNS(W, 'p')) {
      const text = textOf(paragraph);
      if (!text) continue;
      const pPr = wChild(paragraph, 'pPr');
      const style = wAttr(wChild(pPr, 'pStyle'), 'val');
      const heading = !!wChild(pPr, 'outlineLvl') || (style != null && headingStyles.has(style)) || /^(heading|title)/i.test(style || '');
      items.push({ text, heading });
    }

    const core = await zip.readText('docProps/core.xml');
    const title = core ? (parseXml(core).getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]?.textContent || '').trim() : '';
    return { title, items };
  };

  // ---------------- EPUB ----------------
  const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure',
    'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody',
    'td', 'tfoot', 'th', 'thead', 'tr', 'ul']);
  // rt、rp 是日文小說的注音假名，留著會變成「漢字かんじ」
  const SKIP = new Set(['script', 'style', 'rt', 'rp', 'head', 'title', 'svg', 'math']);

  /** 一章 XHTML → 段落（每個不含其他區塊的區塊是一段） */
  const paragraphsFromHtml = root => {
    const items = [];
    let buffer = '';
    let headingDepth = 0;
    let preDepth = 0;
    const flush = () => {
      const text = tidy(buffer);
      buffer = '';
      if (text) items.push({ text, heading: headingDepth > 0 });
    };
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          buffer += preDepth ? child.data : child.data.replace(/[ \t\r\n\f]+/g, ' ');
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.localName.toLowerCase();
        if (SKIP.has(tag)) continue;
        if (tag === 'br') {
          buffer += '\n';
          continue;
        }
        if (!BLOCK.has(tag)) {
          walk(child);
          continue;
        }
        const isHeading = /^h[1-6]$/.test(tag);
        flush();
        if (isHeading) headingDepth++;
        if (tag === 'pre') preDepth++;
        walk(child);
        flush();
        if (isHeading) headingDepth--;
        if (tag === 'pre') preDepth--;
      }
    };
    walk(root);
    flush();
    return items;
  };

  const resolvePath = (base, href) => {
    const url = new URL(href, `http://epub/${base}`);
    return decodeURIComponent(url.pathname.slice(1));
  };

  /**
   * @param {Uint8Array} bytes
   * @returns {Promise<{title: string, chapters: {title: string, items: {text: string, heading: boolean}[]}[]}>}
   */
  const parseEpub = async bytes => {
    const zip = readZip(bytes);
    const container = await zip.readText('META-INF/container.xml');
    if (!container) throw new Error('META-INF/container.xml not found');
    const opfPath = parseXml(container).getElementsByTagName('rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) throw new Error('no rootfile in container.xml');
    const opf = parseXml(await zip.readText(opfPath) || '');
    const byLocalName = name => [...opf.getElementsByTagName('*')].filter(el => el.localName === name);

    const manifest = new Map(byLocalName('item').map(item => [item.getAttribute('id'), {
      path: resolvePath(opfPath, item.getAttribute('href') || ''),
      type: item.getAttribute('media-type') || ''
    }]));
    const spine = byLocalName('itemref')
      .filter(ref => ref.getAttribute('linear') !== 'no')
      .map(ref => manifest.get(ref.getAttribute('idref')))
      .filter(item => item && /x?html/i.test(item.type || item.path));

    // 有 DRM 的書，章節是加密過的，讀出來只會是亂碼
    const encryption = await zip.readText('META-INF/encryption.xml');
    if (encryption && spine.some(item => encryption.includes(item.path.split('/').pop()))) {
      const error = new Error('drm');
      error.code = 'drm';
      throw error;
    }

    const chapters = [];
    for (const item of spine) {
      const html = await zip.readText(item.path);
      if (!html) continue;
      const doc = parseXml(html, /\.html?$/i.test(item.path) && !/xhtml/i.test(item.type) ? 'text/html' : 'application/xhtml+xml');
      const body = doc.getElementsByTagName('body')[0] || doc.documentElement;
      const items = paragraphsFromHtml(body);
      if (!items.length) continue;
      const title = (items.find(p => p.heading)?.text || '').split('\n')[0].slice(0, 80);
      chapters.push({ title, items });
    }
    const title = (byLocalName('title')[0]?.textContent || '').trim();
    return { title, chapters };
  };

  // ---------------- 字幕檔（.srt、.vtt） ----------------
  const TIMING = /-->/;
  // 翻譯時去掉 <i>、<font>、{\an8} 這些標記；匯出時原文照原樣保留
  const cueText = lines => lines
    .map(line => line.replace(/<[^>]+>/g, '').replace(/\{\\[^}]*\}/g, '').trim())
    .filter(Boolean)
    .reduce(DocParse.joinText, '');

  /**
   * @param {string} text
   * @returns {{format: 'srt'|'vtt', header: string, cues: {id: string, timing: string, lines: string[], text: string}[]}}
   */
  const parseSubtitles = text => {
    const source = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const format = /^WEBVTT/.test(source) ? 'vtt' : 'srt';
    const blocks = source.split(/\n[ \t]*\n+/);
    let header = '';
    const cues = [];
    blocks.forEach((block, index) => {
      const lines = block.split('\n').filter(line => line.trim());
      if (!lines.length) return;
      if (format === 'vtt' && index === 0) {
        header = lines.join('\n');
        return;
      }
      const timingIndex = lines.findIndex(line => TIMING.test(line));
      // VTT 的 NOTE、STYLE、REGION 區塊沒有時間軸，略過
      if (timingIndex < 0 || timingIndex > 1) return;
      const cueLines = lines.slice(timingIndex + 1);
      cues.push({
        id: timingIndex === 1 ? lines[0].trim() : '',
        timing: lines[timingIndex].trim(),
        lines: cueLines,
        text: cueText(cueLines)
      });
    });
    return { format, header: header || 'WEBVTT', cues };
  };

  /** 字幕的開始時間，顯示用：00:01:23,456 → 1:23 */
  const cueStart = timing => {
    const match = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,]\d+/.exec(timing.split('-->')[0]);
    if (!match) return '';
    const [, h, m, s] = match;
    return Number(h) ? `${Number(h)}:${m.padStart(2, '0')}:${s}` : `${Number(m)}:${s}`;
  };

  /**
   * 組回字幕檔
   * @param {ReturnType<typeof parseSubtitles>} subtitles
   * @param {string[]} translations 和 cues 一一對應，沒翻到的是空字串
   * @param {'bilingual'|'translation'} mode
   */
  const buildSubtitles = (subtitles, translations, mode) => {
    const cues = subtitles.cues.map((cue, i) => {
      const translated = (translations[i] || '').trim();
      const body = mode === 'translation'
        ? (translated ? [translated] : cue.lines)
        : [...cue.lines, ...(translated ? [translated] : [])];
      const id = subtitles.format === 'srt' ? String(i + 1) : cue.id;
      return [...(id ? [id] : []), cue.timing, ...body].join('\n');
    });
    const head = subtitles.format === 'vtt' ? [subtitles.header] : [];
    return `${[...head, ...cues].join('\n\n')}\n`;
  };

  return { readZip, isZip, parseDocx, parseEpub, paragraphsFromHtml, parseSubtitles, cueStart, buildSubtitles };
})();

globalThis.DocFormats = DocFormats;
