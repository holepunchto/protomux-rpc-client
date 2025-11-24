const Signal = require('signal-promise')
const { isBare } = require('which-runtime')
if (isBare) require('bare-process/global')

function monotonicMs () {
  return Number(process.hrtime.bigint() / 1_000_000n)
}

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
  static NEVER_PROMISE = new Promise(() => {})

  /**
   * Token bucket rate limiter.
   *
   * @param {object} options
   * @param {number} options.capacity - Max tokens (burst capacity)
   * @param {number} options.tokensPerInterval - Tokens refilled each interval
   * @param {number} options.intervalMs - Refill interval in milliseconds
   */
  constructor ({ capacity, tokensPerInterval, intervalMs } = {}) {
    this.capacity = capacity
    this.tokensPerInterval = tokensPerInterval
    this.intervalMs = intervalMs

    this._destroyed = false
    this._tokens = capacity
    this._startTime = monotonicMs()
    this._totalTokenRefilled = 0 // use to calculate effective last refill time
    this._refillTimer = null
    this._refillSignal = new Signal()
  }

  // calculate the effective last refill time based on the total tokens refilled
  // noted: we use this instead of storing last refill time to prevent rounding issue
  get effectiveLastRefillTime () {
    return this._startTime + Math.ceil(this._totalTokenRefilled * this.intervalMs / this.tokensPerInterval)
  }

  _tryRefill () {
    const now = monotonicMs()
    const elapsedMs = now - this.effectiveLastRefillTime
    const tokensToAdd = Math.floor(elapsedMs * this.tokensPerInterval / this.intervalMs)
    if (tokensToAdd <= 0) {
      // if no tokens to add, try to schedule the next refill
      if (!this._refillTimer) {
        // schedule the next refill to be at least 1ms from now
        const timeToWaitMs = Math.max(1, Math.ceil(this.intervalMs / this.tokensPerInterval) - elapsedMs)
        this._refillTimer = setTimeout(() => this._tryRefill(), timeToWaitMs)
      }
      return
    }

    if (this._refillTimer) {
      clearTimeout(this._refillTimer)
      this._refillTimer = null
    }
    this._totalTokenRefilled += tokensToAdd
    this._tokens = Math.min(
      this.capacity,
      this._tokens + tokensToAdd
    )
    this._refillSignal.notify()
  }

  _tryAcquire () {
    this._tryRefill()

    if (this._tokens > 0) {
      this._tokens--
      return true
    }

    return false
  }

  /**
   * Execute an async function after acquiring a token.
   * One token is consumed per execute call.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @param {object} [options] - Options for the execution.
   * @param {Promise<void>} [options.abortSignalPromise] - Promise that rejects when the execution should be aborted.
   * @returns {Promise<T>}
   */
  async execute (fn, { abortSignalPromise = BucketRateLimiter.NEVER_PROMISE } = {}) {
    while (!this._tryAcquire()) {
      if (this._destroyed) {
        throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
      }

      await Promise.race([this._refillSignal.wait(), abortSignalPromise])
    }

    if (this._destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }

    return await fn()
  }

  destroy () {
    if (this._destroyed) {
      throw BucketRateLimiterError.BUCKET_RATE_LIMITER_DESTROYED()
    }

    if (this._refillTimer) {
      clearTimeout(this._refillTimer)
      this._refillTimer = null
    }

    this._destroyed = true
    // notify any waiting acquire calls so the calling function can fail gracefully
    this._refillSignal.notify()
  }
}
