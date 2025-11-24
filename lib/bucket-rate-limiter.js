const Signal = require('signal-promise')

class BucketRateLimiterError extends Error {
  static NEVER_PROMISE = new Promise(() => {})

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
  static NEVER_PROMISE = new Promise(() => {})

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

    this._destroyed = false
    this._tokens = capacity
    this._timer = setInterval(() => this._refill(), this.intervalMs)
    this._refillSignal = new Signal()
  }

  _refill () {
    this._tokens = Math.min(
      this.capacity,
      this._tokens + 1
    )
    this._refillSignal.notify()
  }

  _tryAcquire () {
    if (this._tokens > 0) {
      this._tokens--
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
  async wait ({ abortSignalPromise = BucketRateLimiter.NEVER_PROMISE } = {}) {
    while (!this._tryAcquire()) {
      if (this._destroyed) {
        throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
      }

      await Promise.race([this._refillSignal.wait(), abortSignalPromise])
    }

    if (this._destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }
  }

  destroy () {
    if (this._destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }

    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }

    this._destroyed = true
    // notify any waiting acquire calls so the calling function can fail gracefully
    this._refillSignal.notify()
  }
}
