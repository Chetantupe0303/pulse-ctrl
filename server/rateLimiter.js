/**
 * PulseCtrl Token Bucket Rate Limiter
 * Limits incoming high-frequency events per session to prevent flooding.
 */

class RateLimiter {
  /**
   * @param {number} capacity - Maximum bucket burst size
   * @param {number} refillRatePerSec - Tokens added per second
   */
  constructor(capacity = 120, refillRatePerSec = 80) {
    this.capacity = capacity;
    this.refillRatePerSec = refillRatePerSec;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * Attempts to consume 1 token.
   * @returns {boolean} true if allowed, false if rate limit exceeded
   */
  allow() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.lastRefill = now;

    // Refill tokens based on elapsed time
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRatePerSec);

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  reset() {
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }
}

module.exports = RateLimiter;
