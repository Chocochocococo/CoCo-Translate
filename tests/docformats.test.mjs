// docformats.js：zip、字幕檔（DOCX、EPUB 要用瀏覽器的 DOMParser，在 e2e 測）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { makeZip } from './helpers/zip.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const context = vm.createContext({ TextDecoder, DecompressionStream, Blob, Response, URL, console });
for (const file of ['docparse.js', 'docformats.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
}
const { DocFormats } = context;
const plain = value => JSON.parse(JSON.stringify(value));

test('DocFormats: 讀 zip（壓縮、不壓縮、中文檔名、大小寫不同也找得到）', async () => {
  const bytes = new Uint8Array(makeZip([
    ['mimetype', 'application/epub+zip', { store: true }],
    ['OEBPS/第一章.xhtml', '<p>你好，世界</p>'.repeat(50)]
  ]));
  assert.equal(DocFormats.isZip(bytes), true);
  const zip = DocFormats.readZip(bytes);
  assert.deepEqual(plain(zip.names), ['mimetype', 'OEBPS/第一章.xhtml']);
  assert.equal(await zip.readText('mimetype'), 'application/epub+zip');
  assert.equal(await zip.readText('oebps/第一章.XHTML'), '<p>你好，世界</p>'.repeat(50));
  assert.equal(await zip.read('missing.txt'), null);
  assert.equal(DocFormats.isZip(new TextEncoder().encode('%PDF-1.4')), false);
});

test('DocFormats: SRT 拆成字幕，去掉標記、多行接成一句', () => {
  const srt = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello there,</i>\r\nmy friend.\r\n\r\n2\r\n00:01:02,000 --> 00:01:04,000\r\n{\\an8}Look up!\r\n\r\n3\r\n01:00:00,000 --> 01:00:02,000\r\n這是中文\r\n字幕\r\n';
  const parsed = plain(DocFormats.parseSubtitles(srt));
  assert.equal(parsed.format, 'srt');
  assert.deepEqual(parsed.cues.map(c => c.text), ['Hello there, my friend.', 'Look up!', '這是中文字幕']);
  assert.deepEqual(parsed.cues.map(c => DocFormats.cueStart(c.timing)), ['0:01', '1:02', '1:00:00']);
});

test('DocFormats: VTT 保留檔頭，跳過 NOTE、STYLE，認得有 ID 的字幕', () => {
  const vtt = 'WEBVTT\nKind: captions\nLanguage: en\n\nNOTE made by hand\n\nSTYLE\n::cue { color: yellow }\n\nintro\n00:00.500 --> 00:02.000 align:start\nGood morning.\n\n00:03.000 --> 00:04.000\n<v Bob>See you.</v>\n';
  const parsed = plain(DocFormats.parseSubtitles(vtt));
  assert.equal(parsed.format, 'vtt');
  assert.equal(parsed.header, 'WEBVTT\nKind: captions\nLanguage: en');
  assert.deepEqual(parsed.cues.map(c => [c.id, c.text]), [['intro', 'Good morning.'], ['', 'See you.']]);
});

test('DocFormats: 組回字幕檔（雙語、只有譯文；沒翻到的保留原文）', () => {
  const srt = DocFormats.parseSubtitles('5\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i>\n\n9\n00:00:03,000 --> 00:00:04,000\nBye\n');
  assert.equal(DocFormats.buildSubtitles(srt, ['你好', ''], 'bilingual'),
    '1\n00:00:01,000 --> 00:00:02,000\n<i>Hello</i>\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');
  assert.equal(DocFormats.buildSubtitles(srt, ['你好', ''], 'translation'),
    '1\n00:00:01,000 --> 00:00:02,000\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');
  const vtt = DocFormats.parseSubtitles('WEBVTT\n\nintro\n00:00.500 --> 00:02.000\nGood morning.\n');
  assert.equal(DocFormats.buildSubtitles(vtt, ['早安。'], 'bilingual'), 'WEBVTT\n\nintro\n00:00.500 --> 00:02.000\nGood morning.\n早安。\n');
});
