// sitePatterns.js — 「總是翻譯此網站」的網站規則（content script、popup、設定頁共用）
//
// 支援三種寫法：
//   https://example.com   只比對這個來源（舊版勾選框存的格式）
//   example.com           這個網域，不管 http / https
//   *.example.com         example.com 和它所有的子網域
"use strict";

const SitePatterns = (() => {
  const HOST_PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/;

  const parseUrl = url => {
    try {
      return new URL(url);
    } catch (e) {
      return null;
    }
  };

  /**
   * 把使用者輸入的東西整理成規則；看不懂就回傳 null
   * 例：" HTTPS://Novel.Site/book/1 " → "https://novel.site"
   */
  const normalize = input => {
    const value = (input || '').trim().toLowerCase().replace(/\/+$/, '');
    if (!value) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
      const url = parseUrl(value);
      return url && /^https?:$/.test(url.protocol) ? url.origin : null;
    }
    const host = value.split('/')[0];
    return HOST_PATTERN.test(host) ? host : null;
  };

  const matches = (pattern, url) => {
    const target = parseUrl(url);
    if (!target || !pattern) return false;
    if (pattern.includes('://')) return target.origin === pattern;
    const host = pattern.includes(':') ? target.host : target.hostname;
    if (pattern.startsWith('*.')) {
      const domain = pattern.slice(2);
      return host === domain || host.endsWith('.' + domain);
    }
    return host === pattern;
  };

  // 清單裡第一條符合的規則（沒有就回傳 null）
  const findMatch = (list, url) => (list || []).find(pattern => matches(pattern, url)) || null;

  // 取消勾選時要移除的規則：只移除「專指這個網站」的，萬用字元規則留給設定頁管理
  const exactEntriesFor = (list, url) => {
    const target = parseUrl(url);
    if (!target) return [];
    return (list || []).filter(pattern => pattern === target.origin || pattern === target.hostname || pattern === target.host);
  };

  return { normalize, matches, findMatch, exactEntriesFor };
})();

globalThis.SitePatterns = SitePatterns;
