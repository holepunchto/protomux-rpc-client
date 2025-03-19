# Protomux RPC Client

Connect to [HyperDHT](https://github.com/holepunchto/hyperdht) servers exposing [protomux-rpc](https://github.com/holepunchto/protomux-rpc) endpoints.

Manages connection state for you, and will try re-connecting when the connection is lost.

## Install

```
npm i protomux-rpc-client
```

## Usage

Define a new class which extends `ProtomuxRpcClient`, as in the [example](example.js).

Then expose each RPC method as a separate function which calls `this._makeRequest`, specifying the RPC-method name, the parameters and the encodings. For example:

```
class MyClient extends ProtomuxRpcClient {
  async echo (text) {
    return await this._makeRequest(
      'echo', // The RPC method name
      text, // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}
```

Then create an instance of your client, so you can call its RPC methods:

```
  const dht = new HyperDHT()
  const client = new MyClient(serverPubKey, dht)
  const res1 = await client.echo('ok')
  const res2 = await client.echo('also ok')
  console.log(res1, res2) // ok also ok
```

## API

#### `const client = new ProtomuxRpcClient(serverPubKey, dht, opts)`

Create a new Protomux RPC Client instance. `serverPubKey` is the public key of the RPC server to connect to and `dht` is a hyperDHT instance.

`opts` include:
- `keyPair`: use a specific keyPair to connect to the server, instead of the default one of the DHT instance.
