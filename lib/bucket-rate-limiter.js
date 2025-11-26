const Signal = require('signal-promise')

const NEVER_PROMISE = new Promise(() => {})

class BucketRateLimiterError extends Error {
  constructor (msg, code, fn = BucketRateLimiterError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'BucketRateLimiterError'
  }

  static BUCKET_RATE_LIMITER_DESTROYED () {
    return new BucketRateLimiterError(
      'The bucket rate limiter is destroyed',
      'BUCKET_RATE_LIMITER_DESTROYED',
      BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED
    )
  }
}

module.exports = class BucketRateLimiter {
  /**
   * Token bucket rate limiter.
   *
   * @param {object} options
   * @param {number} options.capacity - Max tokens (burst capacity)
   * @param {number} options.intervalMs - Time interval in milliseconds to refill 1 token
   */
  constructor ({ capacity, intervalMs } = {}) {
    this.capacity = capacity
    this.intervalMs = intervalMs

    this.destroyed = false
    this.tokens = capacity
    this._timer = setInterval(() => this._refill(), this.intervalMs)
    this._refillSignal = new Signal()
  }

  _refill () {
    if (this.tokens >= this.capacity) return // no need to refill
    this.tokens++
    if (this.tokens === 1) this._refillSignal.notify()
  }

  _tryAcquire () {
    if (this.tokens > 0) {
      this.tokens--
      return true
    }

    return false
  }

  /**
   * Wait until a token is available.
   *
   * @param {object} [options] - Options for the execution.
   * @param {Promise<void>} [options.abortSignalPromise] - Promise that rejects when the execution should be aborted.
   * @returns {Promise<void>}
   */
  async wait ({ abortSignalPromise = NEVER_PROMISE } = {}) {
    while (!this._tryAcquire()) {
      if (this.destroyed) {
        throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
      }

      await Promise.race([this._refillSignal.wait(), abortSignalPromise])
    }

    if (this.destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }
  }

  destroy () {
    if (this.destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }

    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }

    this.destroyed = true
    // notify any waiting acquire calls so the calling function can fail gracefully
    this._refillSignal.notify()
  }
}
