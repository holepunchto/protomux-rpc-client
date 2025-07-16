# Protomux RPC Client

Connect to [HyperDHT](https://github.com/holepunchto/hyperdht) servers exposing [protomux-rpc](https://github.com/holepunchto/protomux-rpc) endpoints.

Manages connection state for you:
- Connections are opened lazily, when the first request is made
- The client will try re-connecting when the connection is lost
- Connections are automatically garbage-collected after a period of inactivity
- Supports suspend and resume functionality (for suspending network activity, such as when backgrounding on a phone)

## Install

```
npm i protomux-rpc-client
```

## Usage

For a quick-and-dirty client, simply initialise a `ProtomuxRpcClient` object, and call its `makeRequest` method (see API section for the contract).

For a cleaner approach, define a new class which exposes the available methods, abstracting away the encodings from the user. See the [example](example.js).

## API

#### `const client = new ProtomuxRpcClient(dht, opts)`

Create a new Protomux RPC Client instance. `dht` is a hyperDHT instance.

`opts` include:
- `keyPair`: use a specific keyPair to connect to the server, instead of the default one of the DHT instance.
- `relayThrough`: a function passed on to HyperDHT's `connect` method, to help relay when relevant. Default: `null`.
- `backoffValues`: an array of millisecond delays on reconnection attempts. The delay values are jittered. Default: `[5000, 15000, 60000, 300000]`.
- `suspended`: a boolean for whether the client should be suspended on creation. Default: `false`
- `requestTimeout` default time (in ms) before a request rejects with a timeout error. Default 10000.
- `msGcInterval`: how often to run the garbage collection. Connections are kept open for at least `msGcInterval` ms of inactivity.

#### `client.opened`

Whether the client is opened as a boolean.

#### `client.closed`

Whether the client is closed as a boolean.

#### `client.suspended`

Whether the client is currently suspended as a boolean.

#### `client.dht`

The HyperDHT instance used to make connections.

#### `client.nrConnections`

The number of servers with which the client is currently attempting to keep connections open.

#### `await client.makeRequest(key, methodName, args, opts)`

Creates a request to the server listening at the specified `key` (connecting if necessary) returning the response. `methodName` is a unique string that represents the method. `args` is the value(s) the method is called with.

Options:

```
{
  requestEncoding, // Used to encode the `args`. Default: `c.buffer`
  responseEncoding, // Used to decode the response
  id, // id of the protomux-rpc service
  protocol, // protocol of the protomux-rpc service. Defaults to the server's public key.
  timeout // time (in ms) before a request rejects with a timeout error. Defaults to the requestTimeout.
}
```

#### `await client.suspend()`

Suspends all open RPC clients, destroying their RPC channel.

#### `await client.resume()`

Resumes all suspended RPC clients by reconnecting.

#### `await client.close()`

Closes all RPC clients and cleans up.

#### `await client.gc()`

Forces a garbage collection. Normally never needed, since garbage collection runs at regular intervals.

#### `client.on('gc', (nrRemoved) => {})`

The `gc` events are emitted whenever one or more clients are garbage colllected. `nrRemoved` indicates the amount of gc'd clients.
