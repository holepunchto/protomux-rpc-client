const HyperDHT = require('hyperdht')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const b4a = require('b4a')
const cenc = require('compact-encoding')
const ProtomuxRpcRouter = require('protomux-rpc-router')

const ProtomuxRpcClient = require('..')

test('capability - valid capability', async t => {
  const bootstrap = await setupTestnet(t)
  const namespace = b4a.from('test-namespace')
  const capability = b4a.from('a'.repeat(64), 'hex')
  const { server } = await setupCapabilityServer(t, bootstrap, { namespace, capability })

  const clientDht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(clientDht, { namespace, capability })
  t.teardown(async () => {
    await client.close()
    await clientDht.destroy()
  })

  const res = await client.makeRequest(
    server.publicKey,
    'echo',
    b4a.from('hello'),
    { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
  )
  t.alike(res, b4a.from('hello'))
})

test('capability - invalid capability', async t => {
  t.plan(1)
  const bootstrap = await setupTestnet(t)
  const namespace = b4a.from('test-namespace')
  const serverCapability = b4a.from('a'.repeat(64), 'hex')
  const clientCapability = b4a.from('b'.repeat(64), 'hex')
  const { server } = await setupCapabilityServer(t, bootstrap, { namespace, capability: serverCapability })

  const clientDht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(clientDht, { namespace, capability: clientCapability, requestTimeout: 10000000 })
  t.teardown(async () => {
    await client.close()
    await clientDht.destroy()
  })

  await t.exception(
    async () => {
      await client.makeRequest(
        server.publicKey,
        'echo',
        b4a.from('hello'),
        { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
      )
    },
    /INVALID_REMOTE_CAPABILITY/
  )
})

test('capability - no capability configured', async t => {
  const bootstrap = await setupTestnet(t)
  const { server } = await setupCapabilityServer(t, bootstrap)

  const clientDht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(clientDht)
  t.teardown(async () => {
    await client.close()
    await clientDht.destroy()
  })

  const res = await client.makeRequest(
    server.publicKey,
    'echo',
    b4a.from('hello'),
    { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
  )
  t.alike(res, b4a.from('hello'))
})

test('capability - invalid namespace', async t => {
  t.plan(1)
  const bootstrap = await setupTestnet(t)
  const serverNamespace = b4a.from('server-namespace')
  const clientNamespace = b4a.from('client-namespace')
  const capability = b4a.from('a'.repeat(64), 'hex')
  const { server } = await setupCapabilityServer(t, bootstrap, { namespace: serverNamespace, capability })

  const clientDht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(clientDht, { namespace: clientNamespace, capability, requestTimeout: 500 })
  t.teardown(async () => {
    await client.close()
    await clientDht.destroy()
  })

  await t.exception(
    async () => {
      await client.makeRequest(
        server.publicKey,
        'echo',
        b4a.from('hello'),
        { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
      )
    },
    /INVALID_REMOTE_CAPABILITY/
  )
})

async function setupTestnet (t) {
  const testnet = await createTestnet()
  t.teardown(async () => {
    await testnet.destroy()
  }, { order: 1000_000 })
  return testnet.bootstrap
}

async function setupCapabilityServer (t, bootstrap, { namespace = undefined, capability = null } = {}) {
  const dht = new HyperDHT({ bootstrap })
  const server = dht.createServer()
  const router = new ProtomuxRpcRouter({ namespace, capability })

  router.method(
    'echo',
    { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer },
    (req) => req
  )
  await router.ready()

  server.on('connection', conn => {
    conn.on('error', () => {})
    router.handleConnection(conn).catch(() => {})
  })

  t.teardown(async () => {
    await router.close()
    await dht.destroy()
  }, { order: 100 })

  await server.listen()

  return { server }
}
