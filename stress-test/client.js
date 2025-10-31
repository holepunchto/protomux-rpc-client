const cenc = require("compact-encoding");
const HyperDHT = require("hyperdht");
const ProtomuxRpcClient = require("..");

class EchoClient {
  constructor(key, rpcClient) {
    this.key = key;
    this.rpcClient = rpcClient;
  }

  async echo(text) {
    return await this.rpcClient.makeRequest(
      this.key,
      "echo", // The RPC method name
      text, // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    );
  }
}

const clientId = parseInt(process.argv[2]);
const bootstrap = JSON.parse(process.argv[3]);
const serverPubKey = Buffer.from(process.argv[4], "hex");
const requests = parseInt(process.argv[5]);

async function main() {
  console.log(`Running client #${clientId}`);

  const promises = new Array(requests).fill(0).map(async (_, i) => {
    console.log(`Request #${clientId}:${i} started`);

    const dht = new HyperDHT({ bootstrap });
    const client = new ProtomuxRpcClient(dht);
    const echoClient = new EchoClient(serverPubKey, client);

    try {
      await echoClient.echo("ok");

      console.log(`Request #${clientId}:${i} completed`);
    } finally {
      client.close().catch();
      dht.destroy().catch();
    }
  });

  await Promise.all(promises);
}

main();
