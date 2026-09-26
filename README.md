# CoCo Translate 可可翻譯

[中文](#中文) ｜ [English](#english)

## 中文

雙語對照的瀏覽器翻譯擴充功能，支援 Chrome 與 Firefox。

**官網與使用說明：https://chocochocococo.github.io/CoCo-Translate/**

整頁雙語對照、滑鼠觸發翻譯、單字卡與生字本、YouTube 整句雙語字幕；
翻譯來源支援 Google、Bing、Google Cloud、DeepL，以及 Ollama、OpenRouter、Gemini 等 AI 翻譯。

## 關於

用 Vibe Coding 做出來的擴充：作者沒有學過程式，由 ChatGPT 打好 1.0～1.4 的基礎，1.5 以後的大改版與官網由 Claude（Claude Code）協作完成。

## English

CoCo Translate is a browser extension for Chrome and Firefox that shows translations right next to the original text, so you can read and compare both at once.

- **Bilingual page translation**: each paragraph is followed by its translation, with links and formatting kept. Or replace the original instead.
- **Hover translation**: hold a key (Right Ctrl by default) and point at a paragraph.
- **Word lookup**: select a word to see its meanings by part of speech, English definitions and examples, then save it to your vocabulary list and export it to Anki.
- **YouTube bilingual subtitles**: whole sentences instead of word-by-word captions, plus a transcript side panel.
- **Translation sources**: Google and Bing (no key needed), Google Cloud, DeepL, and AI translation through Ollama, OpenRouter, Gemini, Groq or any OpenAI-compatible API.
- **Interface**: available in English and Traditional Chinese, with light and dark modes.

The website and user guide are in Traditional Chinese: https://chocochocococo.github.io/CoCo-Translate/

**Install**: the extension isn't in the browser stores yet.
- Chrome: download the Chrome zip, unzip it, open `chrome://extensions`, turn on Developer mode, and choose "Load unpacked".
- Firefox: download the xpi, open `about:addons`, click the gear icon, and choose "Install Add-on From File…".

**About**: CoCo was vibe coded by someone who never studied programming. ChatGPT built the foundation (versions 1.0 to 1.4), and Claude (Claude Code) did the 1.5+ rewrite and the website. Bug reports are welcome in [Issues](https://github.com/Chocochocococo/CoCo-Translate/issues).

## 開發 / Development

```sh
npm test            # 單元測試
npm run build       # 打包 dist/chrome、dist/firefox 與 zip / xpi
npm run bump        # 升版本號（-- patch / minor / major / 1.8.0.0）
```

- 程式碼在 `src/`，兩個瀏覽器的 manifest 在 `manifests/`
- 官網在 `docs/`（GitHub Pages）
