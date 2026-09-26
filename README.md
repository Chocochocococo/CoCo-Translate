# CoCo Translate 可可翻譯

雙語對照的瀏覽器翻譯擴充功能，支援 Chrome 與 Firefox。

**官網與使用說明：https://chocochocococo.github.io/CoCo-Translate/**

整頁雙語對照、滑鼠觸發翻譯、單字卡與生字本、YouTube 整句雙語字幕；
翻譯來源支援 Google、Bing、Google Cloud、DeepL，以及 Ollama、OpenRouter、Gemini 等 AI 翻譯。

## 開發

```sh
npm test            # 單元測試
npm run build       # 打包 dist/chrome、dist/firefox 與 zip / xpi
npm run bump        # 升版本號（-- patch / minor / major / 1.8.0.0）
```

- 程式碼在 `src/`，兩個瀏覽器的 manifest 在 `manifests/`
- 官網在 `docs/`（GitHub Pages）
