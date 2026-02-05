const ProtomuxRPC = require('protomux-rpc')
const HyperDHT = require('hyperdht')
const HyperswarmCapability = require('hyperswarm-capability')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const b4a = require('b4a')
const cenc = require('compact-encoding')

const ProtomuxRpcClient = require('..')
const Handshake = require('../lib/handshake')

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
  const client = new ProtomuxRpcClient(clientDht, { namespace, capability: clientCapability, requestTimeout: 500 })
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
    /REQUEST_TIMEOUT/
  )
})

test('capability - no capability configured', async t => {
  const bootstrap = await setupTestnet(t)
  const { server } = await setupRpcServer(t, bootstrap)

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
    /REQUEST_TIMEOUT/
  )
})

test('capability - request after invalid capability still times out', async t => {
  t.plan(2)
  const bootstrap = await setupTestnet(t)
  const namespace = b4a.from('test-namespace')
  const serverCapability = b4a.from('a'.repeat(64), 'hex')
  const clientCapability = b4a.from('b'.repeat(64), 'hex')
  const { server } = await setupCapabilityServer(t, bootstrap, { namespace, capability: serverCapability })

  const clientDht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(clientDht, { namespace, capability: clientCapability, requestTimeout: 300 })
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
    /REQUEST_TIMEOUT/
  )

  await t.exception(
    async () => {
      await client.makeRequest(
        server.publicKey,
        'echo',
        b4a.from('hello'),
        { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
      )
    },
    /REQUEST_TIMEOUT/
  )
})

async function setupTestnet (t) {
  const testnet = await createTestnet()
  t.teardown(async () => {
    await testnet.destroy()
  }, { order: 1000_000 })
  return testnet.bootstrap
}

async function setupRpcServer (t, bootstrap) {
  const dht = new HyperDHT({ bootstrap })
  const server = dht.createServer()

  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  server.on('connection', conn => {
    conn.on('error', () => {})
    const rpc = new ProtomuxRPC(conn, {
      id: serverPubKey,
      valueEncoding: cenc.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer },
      (req) => req
    )
  })

  t.teardown(async () => {
    await dht.destroy()
  }, { order: 100 })

  return { server }
}

async function setupCapabilityServer (t, bootstrap, { namespace, capability }) {
  const dht = new HyperDHT({ bootstrap })
  const server = dht.createServer()

  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  const cap = new HyperswarmCapability(namespace)

  server.on('connection', async conn => {
    conn.on('error', () => {})
    await conn.opened

    const rpc = new ProtomuxRPC(conn, {
      id: serverPubKey,
      valueEncoding: cenc.none,
      handshakeEncoding: Handshake,
      handshake: { capability: cap.generate(conn, capability) }
    })

    rpc.on('open', (handshake) => {
      if (!handshake?.capability || !cap.verify(conn, capability, handshake.capability)) {
        rpc.destroy(new Error('Remote sent invalid capability'))
      }
    })

    rpc.respond(
      'echo',
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer },
      (req) => req
    )
  })

  t.teardown(async () => {
    await dht.destroy()
  }, { order: 100 })

  return { server }
}
