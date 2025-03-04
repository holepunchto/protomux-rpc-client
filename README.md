# Protomux RPC Client

Connect to [protomux-rpc](https://github.com/holepunchto/protomux-rpc).

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
  const dht = new HyperDHT({ bootstrap })
  const client = new MyClient(serverPubKey, dht)
  const res1 = await client.echo('ok')
  const res2 = await client.echo('also ok')
  console.log(res1, res2) // ok also ok
```
