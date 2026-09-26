// youtube.js — YouTube 雙語字幕＋字幕側欄（排在 content.js 後面載入，用它的翻譯、外觀、單字卡）
//
// 整句模式（預設）：使用者開 CC 時，播放器會下載整份字幕檔；我們從效能紀錄拿到那個網址再下載一份，
//   把逐字冒出來的碎片合成完整的句子（captions.js），一開始就整批翻好，播放時照影片時間一次顯示一整句。
//   旁邊的字幕側欄列出整部影片的原文＋譯文，點一句就跳過去，選字可以查單字卡。
// 備援（讀畫面上的 CC）：拿不到字幕檔時（YouTube 改了什麼、嵌入的播放器……），照舊讀正在顯示的 CC 來翻。
//
// 兩種模式都一樣：YouTube 原本的 CC 變透明，在原本的位置顯示「一個」字幕框，可以拖曳、調大小。
// 用整頁翻譯的來源（預設 Google，不耗 AI 額度）。
"use strict";

const YouTubeSubtitles = (() => {
  const isYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  const PLAYER_SELECTOR = '#movie_player, .html5-video-player';
  const CAPTION_WINDOW_SELECTOR = '.ytp-caption-window-container .caption-window';
  const HIDE_NATIVE_STYLE_ID = 'coco-yt-hide-native';
  const THROTTLE_MS = 600;
  const cache = new Map();
  let enabled = false;
  let mode = 'bilingual';          // bilingual：原文＋譯文；translation：只顯示譯文
  let player = null;
  let observer = null;
  let box = null;
  let pollTimer = null;
  let throttleTimer = null;
  let frame = null;
  let lastRun = 0;
  let renderId = 0;
  let lastTranslated = '';
  let lastSignature = '';
  let scale = 1;                   // 字幕大小：以 YouTube 字幕設定的大小為準再乘上這個倍率
  let customPosition = null;       // 使用者拖過的位置 { x, bottom }（播放器寬高的比例）；null＝跟著原字幕
  let dragging = false;
  let lastFontSize = 0;

  // 整句模式
  const CHUNK_SIZE = 30;           // 一次送去翻譯幾句（同一批有上下文，AI 翻得比較順）
  const TICK_MS = 100;
  let track = null;                // { key, videoId, sentences, translations, done }
  let loadingKey = null;
  let resourceObserver = null;
  let tickTimer = null;
  let currentIndex = -2;

  // 字幕側欄
  const PANEL_ID = 'coco-yt-transcript';
  let panelEnabled = true;
  let panel = null;
  let panelList = null;
  let userScrolledAt = 0;

  const normalize = text => text.replace(/\s+/g, '');
  const sameText = (a, b) => normalize(a) === normalize(b);
  const zh = () => uiLanguage === 'zh';

  const currentVideoId = () => {
    try {
      const url = new URL(location.href);
      return url.searchParams.get('v') || url.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{6,})/)?.[1] || '';
    } catch (e) {
      return '';
    }
  };
  const videoElement = () => player?.querySelector('video') || null;
  const trackActive = () => !!track && track.videoId === currentVideoId();

  // 按鈕顯示 CC 關著 → 不管 DOM 裡還剩什麼，都當作沒有字幕
  const captionsTurnedOff = () =>
    player?.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'false';

  // 只看真的有顯示的字幕框：YouTube 會把用過的字幕框藏起來（display: none）卻不刪掉，
  // 之前連那些一起讀，舊字幕就一直黏在畫面上，幹。
  // （我們自己把原字幕設成透明，透明的照樣有大小，所以用 getClientRects 判斷）
  const visibleCaptionWindows = () => {
    if (!player || captionsTurnedOff()) return [];
    return [...player.querySelectorAll(CAPTION_WINDOW_SELECTOR)]
      .filter(win => win.getClientRects().length > 0 && getComputedStyle(win).visibility !== 'hidden');
  };

  const captionLines = () => visibleCaptionWindows()
    .flatMap(win => [...win.querySelectorAll('.caption-visual-line')])
    .map(line => line.textContent.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // 原本的字幕只是變透明：YouTube 照樣更新內容，使用者也照樣能拖曳它的位置
  const hideNativeCaptions = hide => {
    const existing = document.getElementById(HIDE_NATIVE_STYLE_ID);
    if (!hide) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const style = document.createElement('style');
    style.id = HIDE_NATIVE_STYLE_ID;
    style.textContent = '.ytp-caption-window-container { opacity: 0 !important; }';
    (document.head || document.documentElement).appendChild(style);
  };

  const ensureBox = () => {
    if (box && box.isConnected) return box;
    box = document.createElement('div');
    box.id = 'coco-yt-subtitle';
    Object.assign(box.style, {
      position: 'absolute',
      transform: 'translateX(-50%)',
      maxWidth: '90%',
      padding: '0.15em 0.5em',
      background: 'rgba(8, 8, 8, 0.75)',
      color: '#fff',
      textAlign: 'center',
      lineHeight: '1.35',
      borderRadius: '4px',
      cursor: 'move',
      userSelect: 'none',
      zIndex: '60',
      display: 'none',
      whiteSpace: 'pre-line'
    });
    box.title = uiLanguage === 'zh'
      ? '拖曳可以移動字幕；按兩下回到原本 CC 的位置'
      : 'Drag to move the subtitles; double-click to put them back where CC is';
    enableDragging(box);
    const original = document.createElement('div');
    original.className = 'coco-yt-original';
    Object.assign(original.style, { color: '#ddd', fontSize: '0.85em' });
    const translated = document.createElement('div');
    translated.className = 'coco-yt-translated';
    box.append(original, translated);
    player.appendChild(box);
    return box;
  };

  // 字幕框整個留在播放器裡面（拖太出去、或視窗縮小時）
  const placeBox = (centerX, bottom, playerRect) => {
    const halfWidth = box.offsetWidth / 2;
    const maxBottom = Math.max(0, playerRect.height - box.offsetHeight);
    centerX = Math.min(Math.max(centerX, halfWidth), Math.max(halfWidth, playerRect.width - halfWidth));
    bottom = Math.min(Math.max(bottom, 0), maxBottom);
    box.style.left = `${centerX}px`;
    box.style.bottom = `${bottom}px`;
  };

  // 每一幀更新位置：沒拖過就跟著原字幕走（控制列出現時 YouTube 會把它往上推），拖過就停在拖到的地方
  const followNativePosition = () => {
    frame = null;
    if (!box || box.style.display === 'none' || !player) return;
    const playerRect = player.getBoundingClientRect();
    const [captionWindow] = visibleCaptionWindows();
    if (captionWindow) {
      // 字體大小、字型都跟原字幕一樣（使用者在 YouTube 設定的字幕樣式照樣有效），再乘上我們的倍率
      const segment = captionWindow.querySelector('.ytp-caption-segment');
      if (segment) {
        const style = getComputedStyle(segment);
        lastFontSize = parseFloat(style.fontSize) || lastFontSize;
        box.style.fontFamily = style.fontFamily;
      }
    }
    // 還沒讀到原字幕的大小：用 YouTube 預設的大約比例（播放器高度的 1/27）
    const baseSize = lastFontSize || playerRect.height / 27;
    box.style.fontSize = `${Math.round(baseSize * scale * 10) / 10}px`;

    if (customPosition) {
      placeBox(customPosition.x * playerRect.width, customPosition.bottom * playerRect.height, playerRect);
    } else if (captionWindow) {
      const captionRect = captionWindow.getBoundingClientRect();
      placeBox(captionRect.left + captionRect.width / 2 - playerRect.left, playerRect.bottom - captionRect.bottom, playerRect);
    } else if (!box.style.left) {
      // 整句模式在兩句之間原字幕可能不在畫面上：先放在 YouTube 字幕平常的位置
      placeBox(playerRect.width / 2, playerRect.height * 0.08, playerRect);
    }
    frame = requestAnimationFrame(followNativePosition);
  };

  const redraw = () => {
    if (box && box.style.display !== 'none') frame ??= requestAnimationFrame(followNativePosition);
  };

  // 自己的拖曳：以前讓滑鼠穿透去拖透明的原字幕，但我們的框比原字幕大（多了譯文），常常點不到，幹
  const enableDragging = element => {
    // 別讓 YouTube 收到點擊：單擊會暫停、按兩下會全螢幕
    ['click', 'dblclick', 'mouseup', 'pointerup'].forEach(type =>
      element.addEventListener(type, e => e.stopPropagation()));

    element.addEventListener('dblclick', () => {
      customPosition = null;
      chrome.storage.local.remove('youTubeSubtitlePosition');
      redraw();
    });

    element.addEventListener('mousedown', e => {
      if (e.button !== 0 || !player) return;
      e.preventDefault();
      e.stopPropagation();
      const playerRect = player.getBoundingClientRect();
      const boxRect = element.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startCenter = boxRect.left + boxRect.width / 2 - playerRect.left;
      const startBottom = playerRect.bottom - boxRect.bottom;
      dragging = false;

      const onMove = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        if (!dragging && Math.hypot(dx, dy) < 3) return;   // 手抖不算拖
        dragging = true;
        const rect = player.getBoundingClientRect();
        placeBox(startCenter + dx, startBottom - dy, rect);
        customPosition = {
          x: parseFloat(element.style.left) / rect.width,
          bottom: parseFloat(element.style.bottom) / rect.height
        };
      };
      const onUp = upEvent => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        upEvent.stopPropagation();
        if (dragging) chrome.storage.local.set({ youTubeSubtitlePosition: customPosition });
        dragging = false;
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
    });
  };

  const hide = () => {
    if (box) box.style.display = 'none';
  };

  const show = (lines, pending) => {
    const original = lines.join('\n');
    const translations = lines
      .map(line => cache.get(line))
      .filter((text, i) => text && normalize(text) !== normalize(lines[i]));
    // 新的一句還在翻，先留著上一句的譯文，免得一直閃
    let translated = translations.join('\n');
    if (!translated && pending) translated = lastTranslated;
    if (translated) lastTranslated = translated;
    setBoxText(original, translated);
  };

  const setBoxText = (original, translated) => {
    ensureBox();
    const [originalEl, translatedEl] = box.children;
    if (mode === 'translation') {
      // 原字幕藏起來了，翻不出來（或本來就是目標語言）時至少要顯示原文
      originalEl.textContent = '';
      translatedEl.textContent = translated || original;
    } else {
      originalEl.textContent = original;
      translatedEl.textContent = translated;
    }
    originalEl.style.display = originalEl.textContent ? 'block' : 'none';
    translatedEl.style.display = translatedEl.textContent ? 'block' : 'none';
    if (box.style.display === 'none') {
      box.style.display = 'block';
      frame ??= requestAnimationFrame(followNativePosition);
    }
  };

  const render = async () => {
    lastRun = Date.now();
    const lines = captionLines();
    lastSignature = lines.join('\n');
    if (trackActive()) return;   // 整句模式在管，畫面上的 CC 不用讀
    if (!enabled || !lines.length) {
      hide();
      return;
    }
    const id = ++renderId;
    const missing = lines.filter(line => !cache.has(line));
    show(lines, missing.length > 0);
    if (!missing.length) return;

    const { translations, error } = await requestTranslations('page', missing, targetLanguage, 'text', { quiet: true });
    missing.forEach((line, i) => {
      if (!(error && translations[i] === line)) cache.set(line, translations[i]);
    });
    if (id === renderId && enabled && !trackActive()) show(lines, false);
  };

  // 字幕一變就更新；逐字滾動的自動字幕最多每 0.6 秒翻一次
  const schedule = () => {
    if (!enabled || trackActive()) return;
    clearTimeout(throttleTimer);
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
    throttleTimer = setTimeout(render, wait);
  };

  // ================= 整句模式 =================
  const translationOf = index => {
    const translated = track?.translations[index];
    return translated && !sameText(translated, track.sentences[index].text) ? translated : '';
  };

  const renderSentence = () => {
    if (!trackActive() || currentIndex < 0) {
      if (trackActive()) hide();
      return;
    }
    setBoxText(track.sentences[currentIndex].text, translationOf(currentIndex));
  };

  // 照影片時間決定現在是哪一句；換句才重畫，同一句播放中完全不會動
  const tick = () => {
    if (!enabled) return;
    if (track && !trackActive()) resetTrack();   // 換影片了（YouTube 是單頁應用程式）
    if (!trackActive()) return;
    const video = videoElement();
    if (!video) return;
    const index = captionsTurnedOff() ? -1 : Captions.findIndex(track.sentences, video.currentTime * 1000);
    if (index === currentIndex) return;
    currentIndex = index;
    renderSentence();
    highlightPanelLine(index);
  };

  // 離現在播放位置最近、還沒翻的那一批（往後的優先）
  const nextChunk = target => {
    const chunks = Math.ceil(target.sentences.length / CHUNK_SIZE);
    const time = (videoElement()?.currentTime || 0) * 1000;
    let here = target.sentences.findIndex(sentence => sentence.start > time);
    here = Math.floor(Math.max(0, (here < 0 ? target.sentences.length : here) - 1) / CHUNK_SIZE);
    let best = -1;
    let bestDistance = Infinity;
    for (let chunk = 0; chunk < chunks; chunk++) {
      if (target.done.has(chunk)) continue;
      const distance = chunk >= here ? chunk - here : here - chunk + 0.5;
      if (distance < bestDistance) {
        best = chunk;
        bestDistance = distance;
      }
    }
    return best;
  };

  // 一開始就整批翻好：一批一批來，不同時轟炸翻譯來源；失敗的批次等一下再試兩次
  const translateTrack = async target => {
    const language = targetLanguage;
    for (let chunk = nextChunk(target); chunk >= 0; chunk = nextChunk(target)) {
      target.done.add(chunk);
      const from = chunk * CHUNK_SIZE;
      const texts = target.sentences.slice(from, from + CHUNK_SIZE).map(sentence => sentence.text);
      let result = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        result = await requestTranslations('page', texts, language, 'text', { quiet: true });
        if (!result.error || track !== target) break;
        await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
      }
      if (track !== target || language !== targetLanguage || !enabled) return;
      if (!result.error) texts.forEach((_, i) => { target.translations[from + i] = result.translations[i]; });
      updatePanelTranslations(from, from + texts.length);
      if (currentIndex >= from && currentIndex < from + texts.length) renderSentence();
    }
  };

  // Firefox 的 content script 用 content.fetch 才是以網頁的身分送出（帶著 YouTube 的 cookie）
  const pageFetch = (url, options) => (typeof globalThis.content?.fetch === 'function'
    ? globalThis.content.fetch(url, options)
    : fetch(url, options));

  const loadTrack = async info => {
    loadingKey = info.key;
    try {
      const response = await pageFetch(info.url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      if (!body.trim()) throw new Error('empty caption file');
      const sentences = Captions.buildSentences(Captions.parseJson3(JSON.parse(body)));
      if (!sentences.length) throw new Error('no sentences');
      if (!enabled || info.videoId !== currentVideoId()) return;
      track = { ...info, sentences, translations: new Array(sentences.length), done: new Set() };
      currentIndex = -2;
      lastTranslated = '';
      clearTimeout(throttleTimer);
      hide();
      buildPanel();
      tick();
      translateTrack(track);
    } catch (error) {
      // 拿不到就算了，繼續讀畫面上的 CC（備援）
      console.warn('CoCo: 讀不到 YouTube 字幕檔，改用畫面上的 CC', error);
    } finally {
      if (loadingKey === info.key) loadingKey = null;
    }
  };

  // 播放器自己下載字幕檔時，網址會出現在效能紀錄裡（包含它需要的驗證參數）
  const onResource = url => {
    if (!enabled || !url.includes('/api/timedtext')) return;
    const info = Captions.normalizeTrackUrl(url, location.href);
    if (!info || info.videoId !== currentVideoId()) return;
    if (track?.key === info.key || loadingKey === info.key) return;
    loadTrack(info);
  };

  const watchCaptionRequests = () => {
    if (resourceObserver || typeof PerformanceObserver === 'undefined') return;
    resourceObserver = new PerformanceObserver(list => list.getEntries().forEach(entry => onResource(entry.name)));
    try {
      resourceObserver.observe({ type: 'resource', buffered: true });
    } catch (e) {
      resourceObserver.observe({ entryTypes: ['resource'] });
      performance.getEntriesByType('resource').forEach(entry => onResource(entry.name));
    }
  };

  const resetTrack = () => {
    track = null;
    loadingKey = null;
    currentIndex = -2;
    removePanel();
    hide();
    lastSignature = '';
  };

  // 目標語言改了：整份重翻
  const retranslate = () => {
    if (!track) return;
    track = { ...track, translations: new Array(track.sentences.length), done: new Set() };
    updatePanelTranslations(0, track.sentences.length);
    renderSentence();
    translateTrack(track);
  };

  // ================= 字幕側欄 =================
  const formatTime = ms => {
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const seconds = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
  };

  const removePanel = () => {
    panel?.remove();
    panel = null;
    panelList = null;
  };

  const panelHeight = () => {
    const height = player?.getBoundingClientRect().height || 400;
    return `${Math.round(Math.min(Math.max(height, 280), 640))}px`;
  };

  const buildPanel = () => {
    removePanel();
    if (!panelEnabled || !trackActive()) return;
    // 影片頁右邊那一欄；嵌入的播放器、Shorts 沒有就不放
    const host = document.querySelector('#secondary-inner') || document.querySelector('#secondary');
    if (!host) return;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    PageTheme.register(panel);
    Object.assign(panel.style, {
      display: 'flex',
      flexDirection: 'column',
      height: panelHeight(),
      marginBottom: '12px',
      background: 'var(--coco-surface)',
      color: 'var(--coco-text)',
      colorScheme: 'var(--coco-scheme)',
      border: '1px solid var(--coco-border)',
      borderRadius: '12px',
      overflow: 'hidden',
      font: '14px/1.5 system-ui, "Microsoft JhengHei", "PingFang TC", sans-serif',
      boxSizing: 'border-box'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
      borderBottom: '1px solid var(--coco-border)', flexShrink: '0'
    });
    const title = document.createElement('strong');
    title.textContent = zh() ? 'CoCo 雙語字幕' : 'CoCo bilingual transcript';
    Object.assign(title.style, { flex: '1', fontSize: '15px' });
    const count = document.createElement('span');
    count.textContent = zh() ? `${track.sentences.length} 句` : `${track.sentences.length} lines`;
    Object.assign(count.style, { color: 'var(--coco-muted)', fontSize: '12px' });
    const close = document.createElement('button');
    close.className = 'coco-yt-transcript-close';
    close.textContent = '×';
    close.title = zh() ? '關閉字幕側欄（可以在設定頁重新開啟）' : 'Close (turn it back on in the settings page)';
    Object.assign(close.style, {
      border: 'none', background: 'none', color: 'var(--coco-muted)', cursor: 'pointer',
      fontSize: '20px', lineHeight: '1', padding: '0 4px'
    });
    close.addEventListener('click', () => chrome.storage.local.set({ youTubeTranscriptPanel: false }));
    header.append(title, count, close);

    panelList = document.createElement('div');
    Object.assign(panelList.style, { position: 'relative', flex: '1', overflowY: 'auto', padding: '4px 0' });
    track.sentences.forEach((sentence, index) => {
      const line = document.createElement('div');
      line.className = 'coco-yt-line';
      line.dataset.index = index;
      Object.assign(line.style, {
        padding: '6px 12px 6px 9px', borderLeft: '3px solid transparent', cursor: 'pointer'
      });
      const time = document.createElement('span');
      time.textContent = formatTime(sentence.start);
      Object.assign(time.style, { color: 'var(--coco-accent)', fontSize: '12px', marginRight: '6px' });
      const original = document.createElement('span');
      original.className = 'coco-yt-line-original';
      original.textContent = sentence.text;
      const translated = document.createElement('div');
      translated.className = 'coco-yt-line-translation';
      translated.textContent = translationOf(index);
      Object.assign(translated.style, { color: 'var(--coco-muted)', fontSize: '13px' });
      line.append(time, original, translated);
      panelList.appendChild(line);
    });
    // 點一句就跳到那個時間；選取文字（查單字）時不跳
    panelList.addEventListener('click', e => {
      const line = e.target.closest('.coco-yt-line');
      const video = videoElement();
      if (!line || !video || window.getSelection().toString().trim()) return;
      video.currentTime = track.sentences[Number(line.dataset.index)].start / 1000;
      userScrolledAt = 0;
      tick();
    });
    // 使用者自己捲的時候，暫時別自動捲回正在播的那一句
    ['wheel', 'touchmove'].forEach(type => panelList.addEventListener(type, () => { userScrolledAt = Date.now(); }, { passive: true }));

    panel.append(header, panelList);
    host.prepend(panel);
    if (currentIndex >= 0) highlightPanelLine(currentIndex);
  };

  const updatePanelTranslations = (from, to) => {
    if (!panelList) return;
    for (let i = from; i < to; i++) {
      const cell = panelList.children[i]?.querySelector('.coco-yt-line-translation');
      if (cell) cell.textContent = translationOf(i);
    }
  };

  const highlightPanelLine = index => {
    if (!panelList) return;
    panelList.querySelectorAll('.coco-yt-line[data-active="true"]').forEach(line => {
      line.dataset.active = 'false';
      line.style.background = '';
      line.style.borderLeftColor = 'transparent';
    });
    const line = panelList.children[index];
    if (!line) return;
    line.dataset.active = 'true';
    line.style.background = 'var(--coco-surface-2)';
    line.style.borderLeftColor = 'var(--coco-accent)';
    if (Date.now() - userScrolledAt > 4000) {
      panelList.scrollTop = line.offsetTop - panelList.clientHeight / 2 + line.offsetHeight / 2;
    }
  };

  const setPanelEnabled = value => {
    panelEnabled = value !== false;
    if (panelEnabled) buildPanel();
    else removePanel();
  };

  const attach = () => {
    const found = document.querySelector(PLAYER_SELECTOR);
    if (!found || found === player) return;
    observer?.disconnect();
    player = found;
    box = null;
    observer = new MutationObserver(mutations => {
      const captionChanged = mutations.some(m => {
        const target = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
        return target?.closest?.('.ytp-caption-window-container');
      });
      if (captionChanged) schedule();
    });
    observer.observe(player, { childList: true, subtree: true, characterData: true });
  };

  // 保險：YouTube 有時只改 style 就把字幕藏起來（關 CC、換字幕軌），MutationObserver 沒在看屬性，
  // 所以定期比對一次目前的字幕，不一樣就重畫
  const poll = () => {
    attach();
    if (track && !trackActive()) resetTrack();
    if (panel && !panel.isConnected) buildPanel();   // YouTube 重畫側欄時被洗掉了
    if (panel) panel.style.height = panelHeight();
    if (captionLines().join('\n') !== lastSignature) schedule();
  };

  const setEnabled = value => {
    enabled = !!value && isYouTube;
    hideNativeCaptions(enabled);
    if (!enabled) {
      observer?.disconnect();
      observer = null;
      player = null;
      clearInterval(pollTimer);
      pollTimer = null;
      clearTimeout(throttleTimer);
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      box?.remove();
      box = null;
      lastTranslated = '';
      lastSignature = '';
      clearInterval(tickTimer);
      tickTimer = null;
      resourceObserver?.disconnect();
      resourceObserver = null;
      resetTrack();
      return;
    }
    // YouTube 是單頁應用程式，播放器可能晚一點才出現，也可能換掉，定期檢查
    attach();
    pollTimer ??= setInterval(poll, 500);
    tickTimer ??= setInterval(tick, TICK_MS);
    watchCaptionRequests();
    schedule();
  };

  const setMode = value => {
    mode = value === 'translation' ? 'translation' : 'bilingual';
    if (!enabled) return;
    if (trackActive()) renderSentence();
    else schedule();
  };

  const setScale = value => {
    const number = parseFloat(value);
    scale = number >= 0.5 && number <= 3 ? number : 1;
    redraw();
  };

  const setPosition = value => {
    if (dragging) return;   // 自己拖的時候存進去的，不用再套一次
    const valid = value && Number.isFinite(value.x) && Number.isFinite(value.bottom);
    customPosition = valid ? { x: value.x, bottom: value.bottom } : null;
    redraw();
  };

  return { setEnabled, setMode, setScale, setPosition, setPanelEnabled, retranslate, isYouTube };
})();

if (YouTubeSubtitles.isYouTube) {
  const keys = ['enableYouTubeSubtitles', 'youTubeSubtitleMode', 'youTubeSubtitleScale', 'youTubeSubtitlePosition', 'youTubeTranscriptPanel'];
  chrome.storage.local.get(keys, data => {
    YouTubeSubtitles.setMode(data.youTubeSubtitleMode);
    YouTubeSubtitles.setScale(data.youTubeSubtitleScale);
    YouTubeSubtitles.setPosition(data.youTubeSubtitlePosition);
    YouTubeSubtitles.setPanelEnabled(data.youTubeTranscriptPanel);
    YouTubeSubtitles.setEnabled(data.enableYouTubeSubtitles === true);
  });

  // 設定改了馬上生效（content.js 的監聽器先跑，targetLanguage 已經是新的）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('youTubeSubtitleMode' in changes) YouTubeSubtitles.setMode(changes.youTubeSubtitleMode.newValue);
    if ('youTubeSubtitleScale' in changes) YouTubeSubtitles.setScale(changes.youTubeSubtitleScale.newValue);
    if ('youTubeSubtitlePosition' in changes) YouTubeSubtitles.setPosition(changes.youTubeSubtitlePosition.newValue);
    if ('youTubeTranscriptPanel' in changes) YouTubeSubtitles.setPanelEnabled(changes.youTubeTranscriptPanel.newValue);
    if ('enableYouTubeSubtitles' in changes) YouTubeSubtitles.setEnabled(changes.enableYouTubeSubtitles.newValue === true);
    if ('targetLanguage' in changes) YouTubeSubtitles.retranslate();
  });
}
