const test = require('brittle')
const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HyperDHT = require('hyperdht')
const getTestnet = require('hyperdht/testnet')
const b4a = require('b4a')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')

const ProtomuxRpcClient = require('../lib/client')

const DEBUG = false

test('client can connect to DHT server exposing rpc', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)
  const client = await getClient(t, bootstrap, serverPubKey)

  const res = await client.echo('ok')
  t.is(res, 'ok', 'happy path works')
})

test('client can pass relayThrough opt', async t => {
  t.plan(2)
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)

  const relayThrough = () => {
    t.pass('connect through called')
    return null
  }
  const client = await getClient(t, bootstrap, serverPubKey, { relayThrough, backoffValues: [5000, 15000, 60000, 300000] })

  const res = await client.echo('ok')
  t.is(res, 'ok', 'happy path works')
})

test('client can use keyPair opt', async t => {
  t.plan(2)

  const bootstrap = await getBootstrap(t)
  const serverDht = new HyperDHT({ bootstrap })
  t.teardown(async () => {
    await serverDht.destroy()
  }, { order: 900 })

  const server = serverDht.createServer()
  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  const accessSeed = b4a.from('c'.repeat(64), 'hex')
  const accessKeyPair = HyperDHT.keyPair(accessSeed)
  const expectedPubKey = accessKeyPair.publicKey

  server.on('connection', c => {
    if (DEBUG) console.log('(DEBUG) server opened connection')
    t.alike(c.remotePublicKey, expectedPubKey, 'uses keypair generated from seed')

    const rpc = new ProtomuxRPC(c, {
      id: serverPubKey,
      valueEncoding: cenc.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      (req) => req
    )
  })
  const client = await getClient(t, bootstrap, serverPubKey, { accessKeyPair })

  const res = await client.echo('ok')
  t.is(res, 'ok', 'rpc works (sanity check)')
})

test('client timeout opt (connecting hangs)', async t => {
  const bootstrap = await getBootstrap(t)
  const unavailableKey = b4a.from('a'.repeat(64), 'hex')
  const client = await getClient(t, bootstrap, unavailableKey)

  await t.exception(
    async () => { await client.echo('ok', { timeout: 250 }) },
    /REQUEST_TIMEOUT:/,
    'Cannot connect => request timeout error'
  )

  const startTime = Date.now()
  await t.exception(
    async () => { await client.makeRequest('echo', 'oh', { timeout: 1000, requestEncoding: cenc.string, responseEncoding: cenc.string }) },
    /REQUEST_TIMEOUT:/,
    'can specify timeout'
  )
  t.is(Date.now() > startTime + 500, true, 'can override timeout in makeRequest call')
})

test('client timeout opt (slow RPC)', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey, server } = await getServer(t, bootstrap, { delay: 1000 })
  const client = await getClient(t, bootstrap, serverPubKey)

  let connected = false
  server.on('connection', () => {
    connected = true
  })

  await t.exception(
    async () => { await client.echo('ok', { timeout: 250 }) },
    /REQUEST_TIMEOUT:/,
    'slow RPC => timeout'
  )

  t.is(connected, true, 'the client did connect (sanity check)')
})

test('pending requests do not delay closing', async t => {
  // If this test hangs on teardown, this indicates an issue with the cleanup logic
  // like pending timers etc (equivalent to a failing test)

  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap, { delay: 1000 * 60 * 60 * 24 })
  const client = await getClient(t, bootstrap, serverPubKey, { requestTimeout: 1000 * 60 * 60 * 24 })

  await client.connect()

  const reqProm = client.echo('ok') // hangs
  const res = await Promise.allSettled([reqProm, client.close()])
  t.is(res[0].status, 'rejected', 'pending request rejects')
})

test('suspend/resume flow', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)
  const client = await getClient(t, bootstrap, serverPubKey)

  t.is(client.suspended, false, 'default not suspended upon creation')
  await client.suspend()
  t.is(client.suspended, true, 'suspended state updated after suspend')
  await client.resume()
  t.is(client.suspended, false, 'suspended state updated after resume')

  const res = await client.echo('ok')
  t.is(res, 'ok', 'can send a request after resuming')
})

test('start suspended flow', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)
  const client = await getClient(t, bootstrap, serverPubKey, { suspended: true })

  t.is(client.suspended, true, 'can start suspended')

  const startTime = Date.now()
  setTimeout(async () => await client.resume(), 500)

  const res = await client.echo('ok')
  t.is(client.suspended, false, 'request got processed after clientresumed')

  const runTime = Date.now() - startTime
  t.is(runTime > 500, true, 'sanity check: did not make request before resume triggered')
  t.is(res, 'ok', 'correct response (sanity check)')
})

test('request resolves without return value if closed while suspended', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)
  const client = await getClient(t, bootstrap, serverPubKey)

  await client.suspend()
  const p = client.echo('ok')
  p.catch(e => {
    console.error(e)
    t.fail('request should not error when closing')
  })
  await new Promise(resolve => setTimeout(resolve, 100))
  await client.close()

  await t.execution(async () => await p, 'no error on uncompleted request when closing')
})

test('can open rpcs with different id to same server', async t => {
  const bootstrap = await getBootstrap(t)
  const extraIds = [b4a.from('1')]
  const { serverPubKey } = await getServer(t, bootstrap, { extraIds })
  const client = await getClient(t, bootstrap, serverPubKey)
  const client2 = await getClient(t, bootstrap, serverPubKey, { id: extraIds[0] })

  {
    const r1 = await client.echo('ok')
    const r2 = await client2.echo('ok')
    t.is(r1, 'ok', 'sanity check')
    t.is(r2, 'Id: 1 res: ok', 'sanity check')
  }

  await client.close()
  t.is(client.rpc.closed, true, 'sanity check')

  {
    const r2 = await client2.echo('ok still')
    t.is(r2, 'Id: 1 res: ok still', 'can still query r2')
  }
})

test('can open rpcs with different protocol to same server', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap, { extraProtocols: ['extra-protocol'] })
  const client = await getClient(t, bootstrap, serverPubKey)
  const client2 = await getClient(t, bootstrap, serverPubKey, { protocol: 'extra-protocol' })

  {
    const r1 = await client.echo('ok')
    const r2 = await client2.echo('ok')
    t.is(r1, 'ok', 'sanity check')
    t.is(r2, 'Protocol: extra-protocol res: ok', 'uses RPC of other protocol')
  }

  await client.close()
  t.is(client.rpc.closed, true, 'sanity check')

  {
    const r2 = await client2.echo('ok still')
    t.is(r2, 'Protocol: extra-protocol res: ok still', 'can still query r2')
  }
})

test('no interactions if also replicating a corestore with the server peer', async t => {
  const bootstrap = await getBootstrap(t)
  const store = new Corestore(await t.tmp())
  const serverSwarm = new Hyperswarm({ bootstrap })

  const core = store.get({ name: 'core' })
  await core.append('block0')

  serverSwarm.on('connection', c => {
    if (DEBUG) console.log('(DEBUG) server opened connection')
    if (DEBUG) c.on('close', '(DEBUG) server connection closed')
    store.replicate(c)

    const rpc = new ProtomuxRPC(c, {
      id: serverPubKey,
      valueEncoding: cenc.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      async (req) => req
    )
  })
  await serverSwarm.listen()
  serverSwarm.join(core.discoveryKey)
  await new Promise(resolve => setTimeout(resolve, 500)) // TODO: should be a flush

  const serverPubKey = serverSwarm.keyPair.publicKey

  const clientStore = new Corestore(await t.tmp())
  const clientSwarm = new Hyperswarm({ bootstrap })
  clientSwarm.on('connection', c => {
    if (DEBUG) console.log('(DEBUG) client opened connection')
    if (DEBUG) c.on('close', '(DEBUG) client connection closed')

    clientStore.replicate(c)
  })
  const client = new EchoClient(serverPubKey, clientSwarm.dht, { backoffValues: [5000, 15000, 60000, 300000] })

  const clientCore = clientStore.get(core.key)
  await clientCore.ready()
  clientSwarm.join(clientCore.discoveryKey)
  const block0 = await core.get(0)
  t.is(b4a.toString(block0), 'block0', 'sanity check')

  const res = await client.echo('ok')
  t.is(res, 'ok', 'sanity check')
  await client.close()
  t.is(client.rpc.closed, true, 'sanity checked')

  await core.append('block1')
  const block1 = await clientCore.get(1)
  t.is(b4a.toString(block1), 'block1', 'corestore replication not stopped when rpc connection closes')

  await clientSwarm.destroy()
  await clientStore.close()
  await serverSwarm.destroy()
  await store.close()
})

async function getBootstrap (t) {
  const testnet = await getTestnet()
  const { bootstrap } = testnet

  t.teardown(
    async () => {
      await testnet.destroy()
    },
    { order: 1000 }
  )

  return bootstrap
}

async function getServer (t, bootstrap, { delay = null, extraIds = [], extraProtocols = [] } = {}) {
  const serverDht = new HyperDHT({ bootstrap })
  const server = serverDht.createServer()
  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  server.on('connection', c => {
    if (DEBUG) console.log('(DEBUG) server opened connection')
    const rpc = new ProtomuxRPC(c, {
      id: serverPubKey,
      valueEncoding: cenc.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      async (req) => {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay))
        return req
      }
    )

    for (const id of extraIds) {
      const rpcI = new ProtomuxRPC(c, {
        id,
        valueEncoding: cenc.none
      })
      rpcI.respond(
        'echo',
        { requestEncoding: cenc.string, responseEncoding: cenc.string },
        async (req) => {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay))
          return `Id: ${id} res: ${req}`
        }
      )
    }

    for (const protocol of extraProtocols) {
      const rpcI = new ProtomuxRPC(c, {
        id: serverPubKey,
        protocol,
        valueEncoding: cenc.none
      })
      rpcI.respond(
        'echo',
        { requestEncoding: cenc.string, responseEncoding: cenc.string },
        async (req) => {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay))
          return `Protocol: ${protocol} res: ${req}`
        }
      )
    }
  })

  t.teardown(async () => {
    await serverDht.destroy()
  }, { order: 900 })

  return { server, serverDht, serverPubKey }
}

async function getClient (t, bootstrap, serverPubKey, { id, relayThrough, accessKeyPair, suspended, protocol } = {}) {
  const dht = new HyperDHT({ bootstrap })
  const client = new EchoClient(serverPubKey, dht, { id, keyPair: accessKeyPair, protocol, relayThrough, suspended, backoffValues: [5000, 15000, 60000, 300000] })

  t.teardown(async () => {
    await client.close()
    await dht.destroy()
  })

  return client
}

class EchoClient extends ProtomuxRpcClient {
  async echo (text, opts = {}) {
    return await this.makeRequest(
      'echo',
      text,
      { requestEncoding: cenc.string, responseEncoding: cenc.string, ...opts }
    )
  }
}
