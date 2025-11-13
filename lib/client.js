const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HypercoreId = require('hypercore-id-encoding')
const SuspendResource = require('suspend-resource')
const safetyCatch = require('safety-catch')
const Signal = require('signal-promise')
const Backoff = require('./backoff.js')
const waitForRPC = require('./wait-for-rpc.js')
const Errors = require('./errors.js')
const ConcurrentLimiter = require('./concurrent-limiter.js')

class ProtomuxRpcConnection extends SuspendResource {
  constructor (serverKey, dht, { stats, backoffValues, keyPair = null, suspended = false, relayThrough = null, maxConcurrent = 16, id, protocol } = {}) {
    super({ suspended })

    this.serverKey = HypercoreId.decode(serverKey)
    this.rpc = null
    this.dht = dht
    this.stats = stats || {
      connection: {
        attempts: 0,
        opened: 0
      },
      requests: {
        sent: 0,
        success: 0
      }
    }

    this.keyPair = keyPair
    this.relayThrough = relayThrough
    this.backoffValues = backoffValues

    this.id = id || this.serverKey
    this.protocol = protocol

    this._connecting = null
    this._backoff = new Backoff(this.backoffValues)

    this._pendingRPC = null
    this._suspendedSignal = new Signal()
    this._requestConcurrentLimiter = new ConcurrentLimiter({ maxConcurrent })

    this.ready().catch(safetyCatch)
  }

  async _suspend () {
    this._backoff.destroy()
    if (this.rpc) this.rpc.destroy()
    if (this._pendingRPC) this._pendingRPC.destroy()
    await this.connect() // flush
  }

  async _resume () {
    this._backoff = new Backoff(this.backoffValues)
    this._suspendedSignal.notify()
  }

  async _open () {
    // no need to set anything up (the connection is opened lazily)
  }

  async _close () {
    this._backoff.destroy()
    if (this.rpc) this.rpc.destroy()
    if (this._pendingRPC) this._pendingRPC.destroy()

    if (this._connecting) await this._connecting // Debounce
    this._suspendedSignal.notify() // flush any pending requests
  }

  get key () {
    return this.rpc?.stream.publicKey || null
  }

  get stream () {
    return this.rpc?.stream || null
  }

  async connect () {
    if (!this.opened) await this.ready()

    if (this._connecting) return this._connecting

    this._connecting = this._connect()

    try {
      await this._connecting
    } finally {
      this._connecting = null
    }
  }

  async _connect () {
    if (this.rpc && !this.rpc.closed) return

    this._backoff.reset()

    while (!this.closing && !this.suspended && !this.shouldBeSuspended) {
      if (this.dht.destroyed) throw Errors.DHT_DESTROYED()

      this.stats.connection.attempts++

      const socket = this.dht.connect(this.serverKey, { keyPair: this.keyPair, relayThrough: this.relayThrough })
      const rpc = new ProtomuxRPC(socket, {
        id: this.id,
        protocol: this.protocol,
        valueEncoding: cenc.none
      })
      rpc.once('close', () => socket.destroy())

      // always set this so we can nuke it if we want
      this._pendingRPC = rpc

      // Only the first time, set it without waiting
      if (this.rpc === null) {
        this.rpc = rpc
      }
      this.emit('stream', rpc.stream)

      try {
        await waitForRPC(rpc)
        this.stats.connection.opened++
        this._pendingRPC = null
        this.rpc = rpc
        break
      } catch (err) {
        safetyCatch(err)
        this._pendingRPC = null

        if (this.closing || this.suspended) return

        await this._backoff.run()
      }
    }
  }

  async makeRequest (methodName, args, { requestEncoding, responseEncoding, timeout = 10000 } = {}) {
    if (!this.opened) await this.ready()

    // DEVNOTE: there is no need to track timers at object level (to clear them on close):
    // closing causes the RPC clients to close, causing the request to reject
    // which triggers the finally that clears the timeout
    const timeoutSignal = new Signal()
    const timer = setTimeout(
      () => {
        timeoutSignal.notify(Errors.REQUEST_TIMEOUT())
      },
      timeout
    )

    try {
      return await this._requestConcurrentLimiter.execute(async () => {
        return await this._connectAndSendRequest(
          methodName,
          args,
          { requestEncoding, responseEncoding, rpcTimeout: timeout }
        )
      }, { abortSignalPromise: timeoutSignal.wait() })
    } finally {
      clearTimeout(timer)
    }
  }

  async _connectAndSendRequest (methodName, args, { requestEncoding, responseEncoding, rpcTimeout }) {
    while ((!this.rpc || this.rpc.closed) && !this.closing) {
      await this.connect()
      while (this.suspended && !this.closing) {
        await this._suspendedSignal.wait()
        if (this.suspendChanging) await this.suspendChanging // To make sure the suspend finished
      }
    }

    if (this.closing) throw Errors.CLIENT_CLOSING()

    this.stats.requests.sent++
    const res = await this.rpc.request(
      methodName,
      args,
      { requestEncoding, responseEncoding, timeout: rpcTimeout }
    )
    this.stats.requests.success++
    return res
  }
}

module.exports = ProtomuxRpcConnection
