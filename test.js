const test = require('brittle')
const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HyperDHT = require('hyperdht')
const getTestnet = require('hyperdht/testnet')
const b4a = require('b4a')

const ProtomuxRpcClient = require('.')

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
  const client = await getClient(t, bootstrap, serverPubKey, { relayThrough })

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
      valueEncoding: c.none
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

async function getServer (t, bootstrap) {
  const serverDht = new HyperDHT({ bootstrap })
  const server = serverDht.createServer()
  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  server.on('connection', c => {
    if (DEBUG) console.log('(DEBUG) server opened connection')
    const rpc = new ProtomuxRPC(c, {
      id: serverPubKey,
      valueEncoding: c.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      (req) => req
    )
  })

  t.teardown(async () => {
    await serverDht.destroy()
  }, { order: 900 })

  return { serverDht, serverPubKey }
}

async function getClient (t, bootstrap, serverPubKey, { relayThrough, accessKeyPair, suspended } = {}) {
  const dht = new HyperDHT({ bootstrap })
  const client = new EchoClient(serverPubKey, dht, { keyPair: accessKeyPair, relayThrough, suspended })

  t.teardown(async () => {
    await client.close()
    await dht.destroy()
  })

  return client
}

class EchoClient extends ProtomuxRpcClient {
  async echo (text) {
    return await this.makeRequest(
      'echo',
      text,
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}
