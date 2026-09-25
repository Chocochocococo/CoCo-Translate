// rateLimiter.js — 每個翻譯來源一條佇列，限制同時請求數與每分鐘請求數
"use strict";

class RequestQueue {
  /**
   * @param {Object} options
   * @param {number} options.concurrency 同時最多幾個請求
   * @param {number} options.rpm 每分鐘最多幾個請求（0 = 不限）
   */
  constructor({ concurrency = 4, rpm = 0 } = {}) {
    this.concurrency = Math.max(1, concurrency);
    this.minInterval = rpm > 0 ? Math.ceil(60000 / rpm) : 0;
    this.active = 0;
    this.pending = [];
    this.lastStart = 0;
    this.timer = null;
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.pending.push({ task, resolve, reject });
      this._pump();
    });
  }

  _pump() {
    if (this.timer) return;
    while (this.active < this.concurrency && this.pending.length) {
      const wait = this.lastStart + this.minInterval - Date.now();
      if (wait > 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this._pump();
        }, wait);
        return;
      }
      const { task, resolve, reject } = this.pending.shift();
      this.active++;
      this.lastStart = Date.now();
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          this.active--;
          this._pump();
        });
    }
  }
}

globalThis.RequestQueue = RequestQueue;
