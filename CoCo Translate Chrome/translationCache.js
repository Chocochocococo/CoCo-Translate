"use strict";

const TranslationCache = (function () {
  /** 
   * 工具函式集合 
   */
  class Utils {
    /**
     * 將字串用 SHA-1 演算法產生一個 40 字元的 hash 字串
     * @param {string} message
     * @returns {Promise<string>}
     */
    static async stringToSHA1(message) {
      const encoder = new TextEncoder();
      const data = encoder.encode(message);
      const hashBuffer = await crypto.subtle.digest("SHA-1", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    /**
     * 將 bytes 轉成易讀的格式（例如 1.2 MB）
     * @param {number} bytes
     * @returns {string}
     */
    static humanReadableSize(bytes) {
      const thresh = 1024;
      if (Math.abs(bytes) < thresh) {
        return bytes + " B";
      }
      const units = ["KB", "MB", "GB", "TB"];
      let u = -1;
      do {
        bytes /= thresh;
        ++u;
      } while (Math.abs(bytes) >= thresh && u < units.length - 1);
      return bytes.toFixed(1) + " " + units[u];
    }
  }

  /**
   * IndexedDB 快取類別
   */
  class Cache {
    /**
     * @param {string} dbName 資料庫名稱
     * @param {string} storeName 資料表名稱
     */
    constructor(dbName = "TranslationCacheDB", storeName = "cache") {
      this.dbName = dbName;
      this.storeName = storeName;
      this.db = null;
      this.version = 1;
    }

    /**
     * 開啟 IndexedDB 資料庫
     * @returns {Promise<void>}
     */
    async open() {
      if (this.db) {
        return Promise.resolve();
      }
  
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.version);
        
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: "key" });
          }
        };
  
        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve();
        };
  
        request.onerror = (event) => {
          console.error("Failed to open IndexedDB:", event.target.error);
          reject(event.target.error);
        };
      });
    }

    /**
     * 取得一筆資料
     * @param {string} key
     * @returns {Promise<any>}
     */
    async get(key) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject("DB 尚未開啟");
        const tx = this.db.transaction([this.storeName], "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 存入一筆資料
     * @param {Object} entry
     * @returns {Promise<boolean>}
     */
    async set(entry) {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject("DB 尚未開啟");
        const tx = this.db.transaction([this.storeName], "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.put(entry);
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 取得整個 store 佔用的位元組數
     * @returns {Promise<number>}
     */
    async getSize() {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject("DB 尚未開啟");
        let total = 0;
        const tx = this.db.transaction([this.storeName], "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            total += JSON.stringify(cursor.value).length;
            cursor.continue();
          } else {
            resolve(total);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 清除所有快取資料
     * @returns {Promise<boolean>}
     */
    async clear() {
      if (!this.db) {
        try {
          await this.open();
        } catch (err) {
          console.error("無法開啟 DB 以清除快取:", err);
          return Promise.reject("DB 開啟失敗");
        }
      }
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([this.storeName], "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => {
          console.error("清除快取時發生錯誤:", e);
          reject(e);
        };
        const store = tx.objectStore(this.storeName);
        store.clear();
      });
    }
    
    /**
     * 新增：取得 store 中所有資料
     * @returns {Promise<Array>}
     */
    async getAll() {
      return new Promise((resolve, reject) => {
        if (!this.db) return reject("DB 尚未開啟");
        const tx = this.db.transaction([this.storeName], "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.openCursor();
        const results = [];
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            results.push(cursor.value);
            cursor.continue();
          } else {
            resolve(results);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }
  }

  /**
   * TranslationCacheWrapper 提供一個簡單介面來讀寫翻譯快取
   */
  class TranslationCacheWrapper {
    constructor() {
      this.cache = new Cache();
      this.initialized = false;
    }

    async init() {
      if (!this.initialized) {
        await this.cache.open();
        this.initialized = true;
      }
    }

    /**
     * 取得翻譯結果
     * @param {string} originalText 原文
     * @param {string} targetLang 目標語言
     * @returns {Promise<string|null>}
     */
    async getTranslation(originalText, targetLang) {
      await this.init();
      const key = await Utils.stringToSHA1(originalText + "_" + targetLang);
      const entry = await this.cache.get(key);
      if (entry && entry.translatedText) {
        // 套用正則，讓最新的正則規則生效
        let formatted = await applyRegexPatterns(entry.translatedText);
        if (!['en', 'ko'].includes(targetLang)) {
          formatted = formatted
            .replace(/["“”](.+?)["”]/g, '「$1」')
            .replace(/”/g, '」')
            .replace(/“/g, '「');
        }
        return formatted;
      }
      return null;
    }    

    /**
     * 儲存翻譯結果
     * @param {string} originalText 原文
     * @param {string} translatedText 翻譯後文字
     * @param {string} targetLang 目標語言
     * @param {string} detectedLanguage 檢測到的語言（預設 "und"）
     * @returns {Promise<void>}
     */
    async setTranslation(originalText, translatedText, targetLang, detectedLanguage = "und") {
      await this.init();
      const key = await Utils.stringToSHA1(originalText + "_" + targetLang);
      const entry = {
        key,
        originalText,
        translatedText,
        targetLang,
        detectedLanguage,
        timestamp: Date.now()
      };
      await this.cache.set(entry);
    }

    /**
     * 取得快取使用空間，格式化成易讀格式
     * @returns {Promise<string>}
     */
    async getCacheSize() {
      await this.init();
      const sizeBytes = await this.cache.getSize();
      return Utils.humanReadableSize(sizeBytes);
    }

    /**
     * 清除所有快取資料
     * @returns {Promise<void>}
     */
    /*async clearCache() {
      await this.init(); // 確保 DB 已初始化
      return new Promise((resolve, reject) => {
        const tx = this.cache.db.transaction([this.cache.storeName], "readwrite");
        tx.oncomplete = () => {
          console.log("Translation cache cleared successfully, fuck yeah!");
          resolve(true);
        };
        tx.onerror = (e) => {
          console.error("Error clearing translation cache:", e);
          reject(e);
        };
        const store = tx.objectStore(this.cache.storeName);
        store.clear();
      });
    }*/
    
    /**
     * 新增：取得所有翻譯項目
     * @returns {Promise<Array>}
     */
    /**
     * async getAllTranslations() {
      await this.init();
      return this.cache.getAll();
    }*/
    
    /**
     * 新增：更新特定譯文（根據 key 更新 translatedText）
     * @param {string} key
     * @param {string} newTranslatedText
     * @returns {Promise<void>}
     */
    /*async updateTranslation(key, newTranslatedText) {
      await this.init();
      const entry = await this.cache.get(key);
      if (entry) {
        entry.translatedText = newTranslatedText;
        entry.timestamp = Date.now();
        await this.cache.set(entry);
      } else {
        throw new Error("找不到對應的翻譯資料，key: " + key);
      }
    }*/
  }

  // 建立 TranslationCacheWrapper 實例
  const translationCacheInstance = new TranslationCacheWrapper();
  
  // 將 translationCacheInstance 置於全域 (window) 上
  window.TranslationCache = translationCacheInstance;

  return translationCacheInstance;
})();
