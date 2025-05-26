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
  t.is(statelessRpc.nrClients, 0, 'cleaned up clients')
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
  t.is(statelessRpc.nrClients, 0, 'cleaned up clients')
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
    t.is(statelessRpc.nrClients, 2, 'additional client opened')
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
    t.is(statelessRpc.nrClients, 1, '1 client still active')
  }

  clearInterval(server2Int)
  {
    const [nrCleared] = await once(statelessRpc, 'gc')
    t.is(nrCleared, 1, 'the other client is cleared')
    t.is(statelessRpc.nrClients, 0, 'no clients active')
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
  const statelessRpc = new ProtomuxRpcClient(clientDht, { msGcInterval: 10000 })
  t.teardown(async () => {
    await statelessRpc.close()
    await clientDht.destroy()
  })
  await statelessRpc.ready()
  await statelessRpc.suspend()

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

async function setupTestnet (t) {
  const testnet = await createTestnet()
  t.teardown(async () => {
    await testnet.destroy()
  }, { order: 1000 })
  return testnet.bootstrap
}

async function setupRpcServer (t, bootstrap, { msDelay = 0 } = {}) {
  const dht = new HyperDHT({ bootstrap })
  const server = dht.createServer()

  let nrCons = 0

  server.on('connection', conn => {
    if (DEBUG) {
      console.log('RPC connection received')
      conn.on('close', () => { console.log('RPC connection closed') })
    }
    nrCons++
    const rpc = new ProtomuxRPC(conn, {
      id: server.publicKey,
      valueEncoding: cenc.none

    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.buffer, responseEncoding: cenc.buffer },
      async (req) => {
        if (msDelay > 0) await new Promise(resolve => setTimeout(resolve, msDelay))
        return req
      })
  })

  t.teardown(async () => {
    await dht.destroy()
  })

  await server.listen()
  return { server, getNrCons: () => nrCons }
}
