const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HypercoreId = require('hypercore-id-encoding')
const SuspendResource = require('suspend-resource')
const safetyCatch = require('safety-catch')
const Signal = require('signal-promise')
const rrp = require('resolve-reject-promise')
const Backoff = require('./backoff.js')
const waitForRPC = require('./wait-for-rpc.js')
const Errors = require('./errors.js')

class ProtomuxRpcConnection extends SuspendResource {
  constructor (serverKey, dht, { backoffValues, keyPair = null, suspended = false, relayThrough = null, id, protocol } = {}) {
    super({ suspended })

    this.serverKey = HypercoreId.decode(serverKey)
    this.rpc = null
    this.dht = dht

    this.keyPair = keyPair
    this.relayThrough = relayThrough
    this.backoffValues = backoffValues

    this.id = id || this.serverKey
    this.protocol = protocol

    this._connecting = null
    this._backoff = new Backoff(this.backoffValues)

    this._pendingRPC = null
    this._suspendedSignal = new Signal()

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
      if (this.dht.destroyed) return

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

    if (this.closing || this.suspended || this.shouldBeSuspended) return

    const socket = this.rpc.stream
    socket.once('close', () => this.connect().catch(safetyCatch))
  }

  async makeRequest (methodName, args, { requestEncoding, responseEncoding, timeout = 10000 } = {}) {
    if (!this.opened) await this.ready()

    // DEVNOTE: there is no need to track timers at object level (to clear them on close):
    // closing causes the RPC clients to close, causing the request to reject
    // which triggers the finally that clears the timeout
    const { resolve, reject, promise } = rrp()
    const timer = setTimeout(
      () => { reject(Errors.REQUEST_TIMEOUT()) },
      timeout
    )
    promise.catch(safetyCatch) // no unhandleds

    const reqProm = this._connectAndSendRequest(
      methodName,
      args,
      { requestEncoding, responseEncoding, rpcTimeout: timeout } // Pass on the same timeout, so the RPC request does not stay pending forever after our timeout triggered
    )
    reqProm.catch(safetyCatch) // no unhandleds

    try {
      return await Promise.race([reqProm, promise])
    } finally {
      clearTimeout(timer)
      resolve()
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

    return await this.rpc.request(
      methodName,
      args,
      { requestEncoding, responseEncoding, timeout: rpcTimeout }
    )
  }
}

module.exports = ProtomuxRpcConnection
