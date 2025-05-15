const ProtomuxRPC = require('protomux-rpc')
const c = require('compact-encoding')
const HypercoreId = require('hypercore-id-encoding')
const ReadyResource = require('ready-resource')
const safetyCatch = require('safety-catch')
const Signal = require('signal-promise')
const Backoff = require('./lib/backoff.js')
const waitForRPC = require('./lib/wait-for-rpc.js')

class ProtomuxRpcClient extends ReadyResource {
  constructor (serverKey, dht, opts = {}) {
    super()

    this.serverKey = HypercoreId.decode(serverKey)
    this.rpc = null
    this.dht = dht
    this.suspended = !!opts.suspended
    this.keyPair = opts.keyPair || null
    this.relayThrough = opts.relayThrough || null

    this.backoffValues = opts.backoffValues || [5000, 15000, 60000, 300000]

    this._connecting = null
    this._backoff = new Backoff(this.backoffValues)

    this._pendingRPC = null
    this._suspendedSignal = new Signal()

    this.ready().catch(safetyCatch)
  }

  async suspend () {
    if (this.suspended) return
    this.suspended = true
    this._backoff.destroy()
    if (this.rpc) this.rpc.destroy()
    if (this._pendingRPC) this._pendingRPC.destroy()
    await this.connect() // flush
  }

  async resume () {
    if (!this.suspended) return
    this.suspended = false
    this._backoff = new Backoff(this.backoffValues)
    this.connect().catch(safetyCatch) // bg resume
    this._suspendedSignal.notify()
  }

  async _open () {
    await Promise.resolve() // allow a tick to train so users can attach listeners
    await this.connect()
  }

  async close () {
    this._backoff.destroy()
    if (this.rpc) this.rpc.destroy()
    if (this._pendingRPC) this._pendingRPC.destroy()
    return super.close()
  }

  async _close () {
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

    while (!this.closing && !this.suspended) {
      if (this.dht.destroyed) return

      const socket = this.dht.connect(this.serverKey, { keyPair: this.keyPair, relayThrough: this.relayThrough })

      const rpc = new ProtomuxRPC(socket, {
        id: this.serverKey,
        valueEncoding: c.none
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

    if (this.closing || this.suspended) return

    const socket = this.rpc.stream
    socket.once('close', () => this.connect().catch(safetyCatch))
  }

  async makeRequest (methodName, args, { requestEncoding, responseEncoding }) {
    return await this._makeRequest(methodName, args, { requestEncoding, responseEncoding })
  }

  // Deprecated, just use makeRequest in the next major
  // (no point in having this private)
  async _makeRequest (methodName, args, { requestEncoding, responseEncoding }) {
    if (this.opened === false) await this.opening

    while ((!this.rpc || this.rpc.closed) && !this.closing) {
      await this.connect()
      while (this.suspended && !this.closing) await this._suspendedSignal.wait()
    }

    if (this.closing) return

    // TODO: retry logic
    return await this.rpc.request(
      methodName,
      args,
      { requestEncoding, responseEncoding }
    )
  }
}

module.exports = ProtomuxRpcClient
