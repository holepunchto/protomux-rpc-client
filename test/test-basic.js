const { once } = require('events')
const ProtomuxRPC = require('protomux-rpc')
const HyperDHT = require('hyperdht')
const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const b4a = require('b4a')
const cenc = require('compact-encoding')

const ProtomuxRpcClient = require('..')

const DEBUG = false

test('stateless RPC connection lifecycle', async t => {
  const bootstrap = await setupTestnet(t)
  const { server, getNrCons } = await setupRpcServer(t, bootstrap)

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 500 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'hi', 'rpc request processed successfully')
    t.is(getNrCons(), 1, '1 connection opened')
  }
  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('ho'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'ho', 'rpc request processed successfully')
    t.is(getNrCons(), 1, 'connection re-used')
  }

  const [nrCleared] = await once(statelessRpc, 'gc')
  t.is(nrCleared, 1, 'gc event reports nr of connections cleared')
  t.is(statelessRpc.nrConnections, 0, 'cleaned up clients')
})

test('stateless RPC no cleanup if active requests', async t => {
  const bootstrap = await setupTestnet(t)
  const { server, getNrCons } = await setupRpcServer(t, bootstrap, { msDelay: 1000 })

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 250 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })

  let didGc = false
  statelessRpc.once('gc', () => {
    didGc = true
  })

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(didGc, false, 'gc did not run while a request was pending')
    t.is(b4a.toString(res), 'hi', 'rpc request processed successfully')
    t.is(getNrCons(), 1, '1 connection opened')
  }

  const [nrCleared] = await once(statelessRpc, 'gc')
  t.is(nrCleared, 1, 'gc eventually runs')
  t.is(statelessRpc.nrConnections, 0, 'cleaned up clients')
})

test('stateless RPC with multiple servers', async t => {
  const bootstrap = await setupTestnet(t)
  const { server } = await setupRpcServer(t, bootstrap)
  const { server: server2 } = await setupRpcServer(t, bootstrap)

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 500 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'hi', 'rpc request processed successfully')
  }
  {
    const res = await statelessRpc.makeRequest(
      server2.publicKey,
      'echo',
      b4a.from('ho'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'ho', 'rpc request processed successfully')
    t.is(statelessRpc.nrConnections, 2, 'additional client opened')
  }
  // keep the second client open for now
  const server2Int = setInterval(
    async () => {
      try {
        await statelessRpc.makeRequest(
          server2.publicKey,
          'echo',
          b4a.from('ho'),
          { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
        )
      } catch (e) {
        console.error(e)
        t.fail('could not make request to 2nd server (likely a test bug)')
      }
    },
    250
  )

  {
    const [nrCleared] = await once(statelessRpc, 'gc')
    t.is(nrCleared, 1, 'only 1 client cleared')
    t.is(statelessRpc.nrConnections, 1, '1 client still active')
  }

  clearInterval(server2Int)
  {
    const [nrCleared] = await once(statelessRpc, 'gc')
    t.is(nrCleared, 1, 'the other client is cleared')
    t.is(statelessRpc.nrConnections, 0, 'no clients active')
  }
})

test('stateless RPC suspend and resume', async t => {
  const bootstrap = await setupTestnet(t)
  const { server } = await setupRpcServer(t, bootstrap)

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 10000 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'hi', 'rpc request processed successfully')
  }

  await statelessRpc.suspend()
  t.is([...statelessRpc._clientRefs.values()][0].client.suspended, true, 'suspend suspends clients')

  await statelessRpc.resume()
  t.is([...statelessRpc._clientRefs.values()][0].client.suspended, false, 'resume resumes clients')
})

test('stateless RPC can init client suspended', async t => {
  const bootstrap = await setupTestnet(t)
  const { server } = await setupRpcServer(t, bootstrap)

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 10000, suspended: true })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })
  await statelessRpc.ready()
  t.is(statelessRpc.suspended, true, 'starts suspended')

  setTimeout(
    async () => await statelessRpc.resume(),
    500
  )

  {
    const prom = statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )

    // DEVNOTE: this test can break if we do not get the client sync
    t.is([...statelessRpc._clientRefs.values()][0].client.suspended, true, 'client starts suspended')

    const res = await prom
    t.is(b4a.toString(res), 'hi', 'rpc request processed successfully')
    t.is(statelessRpc.suspended, false, 'request did not resolve until after suspended')
  }
})

test('relayThrough opt', async t => {
  t.plan(2)
  const bootstrap = await setupTestnet(t)
  const { server } = await setupRpcServer(t, bootstrap)

  const relayThrough = () => {
    t.pass('relay through called')
    return null
  }

  const { rpcClient } = getRpcClient(t, bootstrap, { relayThrough })

  const res = await rpcClient.makeRequest(
    server.publicKey,
    'echo',
    'hi',
    { requestEncoding: cenc.string, responseEncoding: cenc.string }
  )
  t.is(res, 'hi', 'sanity check')
})

test('keyPair opt', async t => {
  t.plan(2)

  const bootstrap = await setupTestnet(t)
  const serverDht = new HyperDHT({ bootstrap })
  t.teardown(async () => {
    await serverDht.destroy()
  }, { order: 900 })

  const server = serverDht.createServer()
  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  const keyPair = HyperDHT.keyPair(b4a.from('c'.repeat(64), 'hex'))
  const expectedPubKey = keyPair.publicKey

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

  const { rpcClient } = getRpcClient(t, bootstrap, { keyPair })

  const res = await rpcClient.makeRequest(
    server.publicKey,
    'echo',
    'hi',
    { requestEncoding: cenc.string, responseEncoding: cenc.string }
  )
  t.is(res, 'hi', 'sanity check')
})

test('requestTimeout opt', async t => {
  const bootstrap = await setupTestnet(t)
  const unavailableKey = b4a.from('a'.repeat(64), 'hex')
  const { rpcClient } = getRpcClient(t, bootstrap, { requestTimeout: 50 })

  {
    const startTime = Date.now()
    await t.exception(
      async () => { await rpcClient.makeRequest(unavailableKey, 'echo', 'hi') },
      /REQUEST_TIMEOUT:/,
      'Cannot connect => request timeout error'
    )
    t.is(Date.now() < startTime + 500, true, 'uses default timeout by default')
  }

  {
    const startTime = Date.now()
    await t.exception(
      async () => { await rpcClient.makeRequest(unavailableKey, 'echo', 'oh', { timeout: 700 }) },
      /REQUEST_TIMEOUT:/,
      'can specify timeout'
    )
    t.is(Date.now() > startTime + 500, true, 'can override timeout in makeRequest call')
  }
})

test('One server exposing multiple rpc services', async t => {
  const bootstrap = await setupTestnet(t)
  const extraIds = [b4a.from('1')]
  const { server, getNrCons } = await setupRpcServer(t, bootstrap, { extraIds, extraProtocols: ['extra-protocol'] })

  const clientDht = new HyperDHT({ bootstrap })
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 500 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'hi', 'default protocol and id')
    t.is(getNrCons(), 1, '1 connection opened')
  }

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { id: extraIds[0], requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'Id: 1 res: hi', 'rpc request processed successfully')
    t.is(getNrCons(), 2, 'separate connection')
  }

  {
    const res = await statelessRpc.makeRequest(
      server.publicKey,
      'echo',
      b4a.from('hi'),
      { protocol: 'extra-protocol', requestEncoding: cenc.buffer, responseEncoding: cenc.buffer }
    )
    t.is(b4a.toString(res), 'Protocol: extra-protocol res: hi', 'rpc request processed successfully')
    t.is(getNrCons(), 3, 'separate connection')
  }
})

function getRpcClient (t, bootstrap, opts = {}) {
  const dht = new HyperDHT({ bootstrap })
  const rpcClient = new ProtomuxRpcClient(dht, opts)

  t.teardown(async () => {
    await rpcClient.close()
    await dht.destroy()
  }, { order: 1 })

  return { rpcClient, dht }
}

async function setupTestnet (t) {
  const testnet = await createTestnet()
  t.teardown(async () => {
    await testnet.destroy()
  }, { order: 1000_000 })
  return testnet.bootstrap
}

async function setupRpcServer (t, bootstrap, { msDelay = 0, extraIds = [], extraProtocols = [] } = {}) {
  const dht = new HyperDHT({ bootstrap })
  const server = dht.createServer()

  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  let nrCons = 0

  server.on('connection', conn => {
    if (DEBUG) {
      console.log('RPC connection received')
      conn.on('close', () => { console.log('RPC connection closed') })
    }
    nrCons++
    const rpc = new ProtomuxRPC(conn, {
      id: serverPubKey,
      valueEncoding: cenc.none

    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer },
      async (req) => {
        if (msDelay > 0) await new Promise(resolve => setTimeout(resolve, msDelay))
        return req
      }
    )

    for (const id of extraIds) {
      const rpcI = new ProtomuxRPC(conn, {
        id,
        valueEncoding: cenc.none
      })
      rpcI.respond(
        'echo',
        { requestEncoding: cenc.string, responseEncoding: cenc.string },
        async (req) => {
          if (msDelay) await new Promise(resolve => setTimeout(resolve, msDelay))
          return `Id: ${id} res: ${req}`
        }
      )
    }

    for (const protocol of extraProtocols) {
      const rpcI = new ProtomuxRPC(conn, {
        id: serverPubKey,
        protocol,
        valueEncoding: cenc.none
      })
      rpcI.respond(
        'echo',
        { requestEncoding: cenc.string, responseEncoding: cenc.string },
        async (req) => {
          if (msDelay) await new Promise(resolve => setTimeout(resolve, msDelay))
          return `Protocol: ${protocol} res: ${req}`
        }
      )
    }
  })

  t.teardown(async () => {
    await dht.destroy()
  }, { order: 100 })

  return { server, getNrCons: () => nrCons }
}
