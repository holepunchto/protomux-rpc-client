class ProtomuxRpcClientError extends Error {
  constructor (msg, code, fn = ProtomuxRpcClientError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'ProtomuxRpcClientError'
  }

  static REQUEST_TIMEOUT () {
    return new ProtomuxRpcClientError('The request timed out', 'REQUEST_TIMEOUT', ProtomuxRpcClientError.REQUEST_TIMEOUT)
  }
}

module.exports = ProtomuxRpcClientError
