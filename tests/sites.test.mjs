import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync(new URL('../src/sitePatterns.js', import.meta.url), 'utf8'), context);
const { SitePatterns } = context;

test('SitePatterns.normalize: 整理使用者輸入', () => {
  assert.equal(SitePatterns.normalize('  Example.COM  '), 'example.com');
  assert.equal(SitePatterns.normalize('*.Novel.site'), '*.novel.site');
  assert.equal(SitePatterns.normalize('HTTPS://Novel.Site/book/1?x=1'), 'https://novel.site');
  assert.equal(SitePatterns.normalize('example.com/path/to'), 'example.com');
  assert.equal(SitePatterns.normalize('localhost:8080'), 'localhost:8080');
  assert.equal(SitePatterns.normalize('ftp://example.com'), null);
  assert.equal(SitePatterns.normalize('not a site'), null);
  assert.equal(SitePatterns.normalize('**.example.com'), null);
  assert.equal(SitePatterns.normalize(''), null);
});

test('SitePatterns.matches: 三種寫法', () => {
  const m = SitePatterns.matches;
  // 完整來源
  assert.equal(m('https://example.com', 'https://example.com/a/b'), true);
  assert.equal(m('https://example.com', 'http://example.com/'), false);
  assert.equal(m('https://example.com', 'https://www.example.com/'), false);
  // 網域
  assert.equal(m('example.com', 'http://example.com/x'), true);
  assert.equal(m('example.com', 'https://example.com:8443/x'), true);
  assert.equal(m('example.com', 'https://www.example.com/'), false);
  // 萬用字元
  assert.equal(m('*.example.com', 'https://example.com/'), true);
  assert.equal(m('*.example.com', 'https://a.b.example.com/'), true);
  assert.equal(m('*.example.com', 'https://notexample.com/'), false, '不能只比對結尾字串');
  assert.equal(m('*.example.com', 'https://example.com.evil.net/'), false);
  // 帶埠號
  assert.equal(m('localhost:8080', 'http://localhost:8080/'), true);
  assert.equal(m('localhost:8080', 'http://localhost:3000/'), false);
});

test('SitePatterns.exactEntriesFor: 只挑出專指這個網站的規則', () => {
  const list = ['https://a.com', 'a.com', '*.a.com', 'b.com'];
  assert.deepEqual([...SitePatterns.exactEntriesFor(list, 'https://a.com/page')], ['https://a.com', 'a.com']);
  assert.equal(SitePatterns.findMatch(list, 'https://x.a.com/'), '*.a.com');
  assert.equal(SitePatterns.findMatch(list, 'https://c.com/'), null);
});
