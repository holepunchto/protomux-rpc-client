const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HyperDHT = require('hyperdht')
const getTestnet = require('hyperdht/testnet')

const ProtomuxRpcClient = require('.')

class MyClient extends ProtomuxRpcClient {
  async echo (text) {
    return await this.makeRequest(
      'echo', // The RPC method name
      text, // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}

async function main () {
  console.log('Running protomux-RPC client example')
  const testnet = await getTestnet()
  const { bootstrap } = testnet

  const serverDht = new HyperDHT({ bootstrap })
  const server = serverDht.createServer()
  await server.listen()
  const { publicKey: serverPubKey } = server.address()

  server.on('connection', c => {
    console.log('server opened connection')
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

  const dht = new HyperDHT({ bootstrap })
  const client = new MyClient(serverPubKey, dht)

  const res = await client.echo('ok')
  console.log('Server replied with', res)

  await client.close()
  await dht.destroy()
  await serverDht.destroy()
  await testnet.destroy()
}

main()
