const ProtomuxRPC = require('protomux-rpc')
const cenc = require('compact-encoding')
const HyperDHT = require('hyperdht')
const getTestnet = require('hyperdht/testnet')
const { Worker, workerData, isMainThread } = require('node:worker_threads')
const ProtomuxRpcClient = require('.')

class EchoClient {
  constructor (key, rpcClient) {
    this.key = key
    this.rpcClient = rpcClient
  }

  async echo (text) {
    return await this.rpcClient.makeRequest(
      this.key,
      'echo', // The RPC method name
      text, // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}

async function serverMain () {
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
      valueEncoding: cenc.none
    })
    rpc.respond(
      'echo',
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      (req) => {
        console.log('echo request received', req)
        return req
      }
    )
  })

  const worker = new Worker(__filename, {
    workerData: {
      bootstrap,
      serverPubKeyHex: serverPubKey.toString('hex')
    }
  })

  await new Promise((resolve, reject) => {
    worker.on('exit', (code) => {
      console.log('worker exited with code', code)
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`))
      } else {
        resolve()
      }
    })
  })

  await serverDht.destroy()
  await testnet.destroy()
}

async function clientMain () {
  const { bootstrap, serverPubKeyHex } = workerData
  const serverPubKey = Buffer.from(serverPubKeyHex, 'hex')

  const dht = new HyperDHT({ bootstrap })
  const client = new ProtomuxRpcClient(dht)
  const echoClient = new EchoClient(serverPubKey, client)
  const res = await echoClient.echo('\0'.repeat(1024 * 1024 * 16))
  console.log('Server replied with', res)

  await client.close()
  await dht.destroy()
}

async function main () {
  if (isMainThread) {
    await serverMain().catch(error => {
      console.log('serverMain error', error)
    })
  } else {
    await clientMain().catch(error => {
      console.log('clientMain error', error)
    })
  }
}

main()
