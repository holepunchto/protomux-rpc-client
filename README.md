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
  async echo (text) {
    return await this._makeRequest(
      'echo', // The RPC method name
      text, // The RPC method parameters
      { requestEncoding: cenc.string, responseEncoding: cenc.string }
    )
  }
```
