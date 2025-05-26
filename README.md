# Protomux RPC Client

Connect to [HyperDHT](https://github.com/holepunchto/hyperdht) servers exposing [protomux-rpc](https://github.com/holepunchto/protomux-rpc) endpoints.

Manages connection state for you: connections are opened lazily, when the first request is made. The client will try re-connecting when the connection is lost. 

## Install

```
npm i protomux-rpc-client
```

## Usage

Define a new class which extends `ProtomuxRpcClient`, as in the [example](example.js).

Then expose each RPC method as a separate function which calls `this.makeRequest`, specifying the RPC-method name, the parameters and the encodings. For example:

```
class MyClient extends ProtomuxRpcClient {
  async echo (text) {
    return await this.makeRequest(
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
- `relayThrough`: a function passed on to HyperDHT's `connect` method, to help relay when relevant. Default: `null`.
- `backoffValues`: an array of millisecond delays on reconnection attempts. The delay values are jittered. Default: `[5000, 15000, 60000, 300000]`.
- `suspended`: a boolean for whether the client should be suspended on creation. Default: `false`
- `requestTimeout` default time (in ms) before a request rejects with a timeout error. Default 10000.

#### `client.stream`

The stream used by the client.

#### `client.key`

The stream's public key. `null` if the stream has not been set yet.

#### `client.opened`

Whether the client is opened as a boolean.

#### `client.closed`

Whether the client is closed as a boolean.

#### `client.suspended`

Whether the client is currently suspended as a boolean.

#### `client.dht`

The HyperDHT instance used to create the RPC client.

#### `await client.makeRequest(methodName, args, opts)`

Creates a request (connecting if necessary) returning the response. `methodName` is a unique string that represents the method. `args` is the value(s) the method is called with.

Options:

```
{
  requestEncoding, // Used to encode the `args`. Default: `c.buffer`
  responseEncoding, // Used to decode the response
  timeout // time (in ms) before a request rejects with a timeout error. Defaults to the requestTimeout.
}
```

This method can be called directly on a `ProtomuxRpcClient` instance, specifying the method name, its arguments and the encodings. Another good pattern is to subclass the `ProtomuxRpcClient` class and to define a function for each endpoint which calls `makeRequest` with the correct encodings and function name. That way these details are abstracted from the consumer of your API.


Example:

```js
class MyClient extends ProtomuxRpcClient {
  async myRequest () {
    return await this.makeRequest(
      'ping', // The RPC method name
      'boop', // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
}
```

#### `await client.connect()`

Attempt to connect to the `serverPubKey`. Normally, there is no need to call this method directly (it is called under the hood by `client.makeRequest(...)`)

#### `await client.suspend()`

Suspends the RPC client destroying the RPC channel.

#### `await client.resume()`

Resumes a suspended RPC client by reconnecting.

#### `await client.close()`

Close the RPC client.

#### `client.on('stream', (stream) => {})`

The `stream` events emits the RPC's stream when it is setup.
