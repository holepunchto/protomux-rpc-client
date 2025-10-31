const ProtomuxRPC = require("protomux-rpc");
const cenc = require("compact-encoding");
const HyperDHT = require("hyperdht");
const getTestnet = require("hyperdht/testnet");
const cp = require("child_process");

const config = require("./config.json");

async function main() {
  console.log("Running server");
  const testnet = await getTestnet();
  const { bootstrap } = testnet;

  const serverDht = new HyperDHT({ bootstrap });
  const server = serverDht.createServer();
  await server.listen();
  const { publicKey: serverPubKey } = server.address();

  server.on("connection", (c) => {
    const rpc = new ProtomuxRPC(c, {
      id: serverPubKey,
      valueEncoding: cenc.none,
    });
    rpc.respond(
      "echo",
      { requestEncoding: cenc.string, responseEncoding: cenc.string },
      (req) => req
    );
  });

  console.time("benchmark");

  const promises = new Array(config.workers).fill(0).map((_, i) => {
    console.log(`Client ${i} started`);

    const clientProcess = cp.fork(
      __dirname + "/client.js",
      [
        i.toString(10),
        JSON.stringify(bootstrap),
        serverPubKey.toString("hex"),
        config.requestsPerWorker,
      ],
      {
        stdio: "inherit",
      }
    );
    return new Promise((resolve, reject) => {
      clientProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`process exit with code ${code}`));
        }
      });
    });
  });

  await Promise.all(promises);

  console.timeEnd("benchmark");

  await serverDht.destroy();
  await testnet.destroy();
}

main();
