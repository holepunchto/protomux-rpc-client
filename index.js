const SuspendResource = require('suspend-resource')
const IdEnc = require('hypercore-id-encoding')
const safetyCatch = require('safety-catch')
const Client = require('./lib/client')

class ClientRef {
  constructor (client) {
    this.client = client
    this.lastUsed = Date.now()
    this.refs = 1
  }

  bumpLastUsed () {
    this.lastUsed = Date.now()
  }

  addRef () {
    this.refs++
  }

  unref () {
    this.refs--
  }
}

class ProtomuxRpcClient extends SuspendResource {
  constructor (
    dht,
    {
      msGcInterval = 60000,
      suspended = false,
      relayThrough = null,
      keyPair,
      requestTimeout = 10000,
      maxConcurrentPerService = 16,
      backoffValues,
      rateLimitPerService = { capacity: 50, intervalMs: 200 }
    } = {}) {
    super({ suspended })

    this.dht = dht
    this.msGcInterval = msGcInterval
    this.relayThrough = relayThrough
    this.keyPair = keyPair
    this.requestTimeout = requestTimeout
    this.backoffValues = backoffValues || [5000, 15000, 60000, 300000]
    this.maxConcurrentPerService = maxConcurrentPerService
    this.rateLimitPerService = rateLimitPerService

    this.stats = {
      connection: {
        attempts: 0,
        opened: 0
      },
      requests: {
        sent: 0,
        success: 0
      }
    }
    this._clientRefs = new Map()
    this._gcInterval = null
  }

  get nrConnections () {
    return this._clientRefs.size
  }

  async _open () {
    this._gcInterval = setInterval(
      this.gc.bind(this), this.msGcInterval
    )
  }

  async _close () {
    clearInterval(this._gcInterval)

    const proms = []
    for (const { client } of this._clientRefs.values()) {
      proms.push(client.close())
    }
    await Promise.all(proms)
  }

  _getClient (key, protocol, id) {
    if (this.closing) throw new Error('Closing')

    // DEVNOTE: when a single server exposes multiple RPC services,
    // we get a fully separate client for each service (with distinct protocols and ids).
    // Every client will open its own socket and manage its own state.
    // Note: can be changed later if there is a usecase (inefficient socket use),
    // but it avoids a lot of complexity (no need for ref counting)
    const uid = `${IdEnc.normalize(key)}-protocol-${protocol || ''}-id-${id || ''}`

    let ref = this._clientRefs.get(uid)
    if (ref) {
      ref.bumpLastUsed()
      ref.refs++
      return ref
    }

    const opts = {
      relayThrough: this.relayThrough,
      suspended: this.suspended,
      keyPair: this.keyPair,
      backoffValues: this.backoffValues,
      id,
      protocol,
      stats: this.stats,
      maxConcurrent: this.maxConcurrentPerService,
      rateLimit: this.rateLimitPerService
    }
    const client = new Client(key, this.dht, opts)
    ref = new ClientRef(client)
    this._clientRefs.set(uid, ref)
    return ref
  }

  gc () {
    const removed = []
    const minTime = Date.now() - this.msGcInterval

    for (const [id, { client, lastUsed, refs }] of this._clientRefs) {
      if (refs > 0) continue
      if (lastUsed >= minTime) continue
      removed.push(id)
      client.close().catch(safetyCatch)
    }

    for (const r of removed) this._clientRefs.delete(r)
    if (removed.length > 0) this.emit('gc', removed.length)
  }

  async _suspend () {
    const proms = []
    for (const ref of this._clientRefs.values()) {
      proms.push(ref.client.suspend())
    }
    await Promise.all(proms)
  }

  async _resume () {
    const proms = []
    for (const ref of this._clientRefs.values()) {
      proms.push(ref.client.resume())
    }
    await Promise.all(proms)
  }

  async makeRequest (key, methodName, args, { requestEncoding, responseEncoding, timeout, protocol, id } = {}) {
    timeout = timeout || this.requestTimeout
    if (!this.opened) await this.ready()

    const ref = this._getClient(key, protocol, id)
    try {
      return await ref.client.makeRequest(methodName, args, { requestEncoding, responseEncoding, timeout })
    } finally {
      ref.unref()
    }
  }
}

module.exports = ProtomuxRpcClient
