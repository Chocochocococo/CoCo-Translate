// theme.js — 外觀：auto（跟著系統）／light（淺色）／dark（深色）
// 放在 <head> 裡最先載入：先用 localStorage 的快取立刻套用，打開時才不會先閃一下白色
"use strict";

const CocoTheme = (() => {
  const STORAGE_KEY = 'uiTheme';
  const CACHE_KEY = 'cocoTheme';
  const MODES = ['auto', 'light', 'dark'];
  const listeners = [];
  let current = 'auto';

  const normalize = mode => (MODES.includes(mode) ? mode : 'auto');

  const apply = mode => {
    current = normalize(mode);
    const root = document.documentElement;
    if (current === 'auto') delete root.dataset.theme;
    else root.dataset.theme = current;
    try {
      localStorage.setItem(CACHE_KEY, current);
    } catch (e) {
      // 隱私模式之類的拿不到 localStorage，沒關係
    }
    listeners.forEach(listener => listener(current));
  };

  try {
    apply(localStorage.getItem(CACHE_KEY));
  } catch (e) {
    // 同上
  }

  chrome.storage.local.get([STORAGE_KEY], data => apply(data[STORAGE_KEY]));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) apply(changes[STORAGE_KEY].newValue);
  });

  const set = mode => {
    apply(mode);
    chrome.storage.local.set({ [STORAGE_KEY]: current });
  };

  // auto → light → dark → auto
  const cycle = () => set(MODES[(MODES.indexOf(current) + 1) % MODES.length]);

  const onChange = listener => {
    listeners.push(listener);
    listener(current);
  };

  return { MODES, get: () => current, set, cycle, onChange };
})();
