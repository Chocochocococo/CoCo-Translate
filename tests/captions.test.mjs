// captions.js：YouTube 字幕檔 → 完整句子
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const context = vm.createContext({ URL, console });
vm.runInContext(fs.readFileSync(path.join(SRC, 'captions.js'), 'utf8'), context, { filename: 'captions.js' });
const { Captions } = context;
const plain = value => JSON.parse(JSON.stringify(value));
const sentencesOf = data => plain(Captions.buildSentences(Captions.parseJson3(data)));

// 自動產生的字幕：一個字一段，一邊播一邊冒出來
const ASR = {
  events: [
    { tStartMs: 0, dDurationMs: 60000, wWinId: 1 },   // 視窗設定，沒有文字
    { tStartMs: 0, dDurationMs: 4000, segs: [
      { utf8: 'Today' }, { utf8: ' we', tOffsetMs: 400 }, { utf8: ' will', tOffsetMs: 800 },
      { utf8: ' learn', tOffsetMs: 1200 }, { utf8: ' about', tOffsetMs: 1600 }, { utf8: ' foxes.', tOffsetMs: 2000 }
    ] },
    { tStartMs: 2600, dDurationMs: 3000, segs: [
      { utf8: 'They' }, { utf8: ' are', tOffsetMs: 300 }, { utf8: ' clever', tOffsetMs: 600 }, { utf8: ' animals.', tOffsetMs: 900 }
    ] },
    { tStartMs: 3600, dDurationMs: 2000, aAppend: 1, segs: [{ utf8: '\n' }] },
    { tStartMs: 10000, dDurationMs: 2000, segs: [{ utf8: 'Goodbye everyone' }] }
  ]
};

test('Captions: 自動字幕逐字的碎片合成完整句子', () => {
  const sentences = sentencesOf(ASR);
  assert.deepEqual(sentences.map(s => s.text), ['Today we will learn about foxes.', 'They are clever animals.', 'Goodbye everyone']);
  assert.deepEqual(sentences.map(s => s.start), [0, 2600, 10000]);
  // 顯示到下一句開始為止
  assert.equal(sentences[0].displayEnd, 2600);
});

test('Captions: 手動字幕一行一行的，跨行的一句話也會合在一起', () => {
  const sentences = sentencesOf({ events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'I think that\nwe should' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'go home now.' }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Okay!' }] }
  ] });
  assert.deepEqual(sentences.map(s => s.text), ['I think that we should go home now.', 'Okay!']);
});

test('Captions: 沒有標點的自動字幕，停頓太久或太長就切開', () => {
  const words = Array.from({ length: 40 }, (_, i) => ({ utf8: `${i ? ' ' : ''}word${i}`, tOffsetMs: i * 200 }));
  const sentences = sentencesOf({ events: [
    { tStartMs: 0, dDurationMs: 9000, segs: words },
    { tStartMs: 20000, dDurationMs: 1000, segs: [{ utf8: 'after' }, { utf8: ' a', tOffsetMs: 200 }, { utf8: ' pause', tOffsetMs: 400 }] }
  ] });
  assert.equal(sentences[0].text.split(' ').length, 32, '最多 32 個字就硬切');
  assert.equal(sentences.at(-1).text, 'after a pause', '停頓超過 1.5 秒就是新的一句');
});

test('Captions: 中日韓文字接起來不加空格', () => {
  const sentences = sentencesOf({ events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: '今天我們' }] },
    { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: '要學習狐狸。' }] }
  ] });
  assert.deepEqual(sentences.map(s => s.text), ['今天我們要學習狐狸。']);
});

test('Captions.findIndex: 照時間找到現在該顯示的那一句，兩句之間太久就不顯示', () => {
  const sentences = Captions.buildSentences(Captions.parseJson3(ASR));
  assert.equal(Captions.findIndex(sentences, 500), 0);
  assert.equal(Captions.findIndex(sentences, 2600), 1);
  assert.equal(Captions.findIndex(sentences, 8000), -1);
  assert.equal(Captions.findIndex(sentences, 10500), 2);
  assert.equal(Captions.findIndex(sentences, -1), -1);
});

test('Captions.normalizeTrackUrl: 改要 json3、拿掉 YouTube 的自動翻譯、保留驗證參數', () => {
  const info = plain(Captions.normalizeTrackUrl('/api/timedtext?v=abc123&lang=en&kind=asr&fmt=srv3&tlang=ja&pot=TOKEN'));
  const url = new URL(info.url);
  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.searchParams.get('fmt'), 'json3');
  assert.equal(url.searchParams.get('tlang'), null);
  assert.equal(url.searchParams.get('pot'), 'TOKEN');
  assert.equal(info.videoId, 'abc123');
  assert.equal(info.key, 'abc123|en|asr|');
  assert.equal(Captions.normalizeTrackUrl('https://www.youtube.com/youtubei/v1/player'), null);
  assert.equal(Captions.normalizeTrackUrl('/api/timedtext?lang=en'), null);
});

test('Captions: >> 換人講話要斷句並拿掉記號，[applause] 這種音效標記自己一行', () => {
  const sentences = sentencesOf({ events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: '[applause] >> Every year I teach' }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: 'a couple of hundred students.' }] },
    { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'They are stressed. >> Coming down the ladder now.' }] },
    { tStartMs: 6000, dDurationMs: 1000, segs: [{ utf8: '>> We will do it' }] },
    { tStartMs: 7000, dDurationMs: 1000, segs: [{ utf8: 'on the moon.' }] }
  ] });
  assert.deepEqual(sentences.map(s => s.text), [
    '[applause]',
    'Every year I teach a couple of hundred students.',
    'They are stressed.',
    'Coming down the ladder now.',
    'We will do it on the moon.'
  ]);
});

test('Captions: 自動字幕逐字的 >> 也會斷句', () => {
  const sentences = sentencesOf({ events: [
    { tStartMs: 0, dDurationMs: 3000, segs: [
      { utf8: 'so' }, { utf8: ' yeah', tOffsetMs: 300 }, { utf8: ' >>', tOffsetMs: 600 }, { utf8: ' thank', tOffsetMs: 900 }, { utf8: ' you', tOffsetMs: 1200 }
    ] }
  ] });
  assert.deepEqual(sentences.map(s => s.text), ['so yeah', 'thank you']);
});
