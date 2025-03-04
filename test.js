const test = require('brittle')
const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HyperDHT = require('hyperdht')
const getTestnet = require('hyperdht/testnet')

const ProtomuxRpcClient = require('.')

const DEBUG = false

test('client can connect to DHT server exposing rpc', async t => {
  const bootstrap = await getBootstrap(t)
  const { serverPubKey } = await getServer(t, bootstrap)
  const client = await getClient(t, bootstrap, serverPubKey)

  const res = await client.echo('ok')
  t.is(res, 'ok', 'happy path works')
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

async function getClient (t, bootstrap, serverPubKey) {
  const dht = new HyperDHT({ bootstrap })
  const client = new EchoClient(serverPubKey, dht)

  t.teardown(async () => {
    await client.close()
    await dht.destroy()
  })

  return client
}

class EchoClient extends ProtomuxRpcClient {
  async echo (text) {
    return await this._makeRequest(
      'echo',
      text,
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}
