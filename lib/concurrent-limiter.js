const Signal = require('signal-promise')
const ProtomuxRpcClientError = require('./errors')

module.exports = class ConcurrentLimiter {
  /**
   * @param {object} options
   * @param {number} options.maxConcurrent - Maximum concurrent executions.
   */
  constructor ({ maxConcurrent } = {}) {
    this._maxConcurrent = maxConcurrent
    this._active = 0
    this._releaseSignal = new Signal()
    this._destroyed = false
  }

  _tryAcquire () {
    if (this._active < this._maxConcurrent) {
      this._active++
      return true
    }

    return false
  }

  _release () {
    this._active--
    this._releaseSignal.notify()
  }

  /**
   * Execute an async function with a timeout.
   *
   * @template T
   * @param {() => Promise<T>} fn
   * @param {object} [options] - Options for the execution.
   * @param {Promise<void>} [options.abortSignalPromise] - Promise that resolves when the execution should be aborted.
   * @returns {Promise<T>}
   */
  async execute (fn, { abortSignalPromise } = {}) {
    while (!this._tryAcquire()) {
      if (this._destroyed) {
        throw ProtomuxRpcClientError.CONCURRENT_LIMITER_DESTROYED()
      }

      if (abortSignalPromise) {
        await Promise.race([this._releaseSignal.wait(), abortSignalPromise])
      } else {
        await this._releaseSignal.wait()
      }
    }

    if (this._destroyed) {
      throw ProtomuxRpcClientError.CONCURRENT_LIMITER_DESTROYED()
    }

    try {
      return await fn()
    } finally {
      this._release()
    }
  }

  destroy () {
    if (this._destroyed) {
      throw ProtomuxRpcClientError.CONCURRENT_LIMITER_DESTROYED()
    }

    this._destroyed = true
    // notify any waiting acquire calls so the calling function can fail gracefully
    this._releaseSignal.notify()
  }
}
