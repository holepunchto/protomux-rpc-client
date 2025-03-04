module.exports = function waitForRPC (rpcClient) {
  return new Promise((resolve, reject) => {
    rpcClient.on('open', onopen)
    rpcClient.on('destroy', ondestroy)

    function onopen (handshake) {
      removeListener()
      resolve(handshake)
    }

    function ondestroy () {
      removeListener()
      reject(new Error('Client could not connect'))
    }

    function removeListener () {
      rpcClient.off('open', onopen)
      rpcClient.off('destroy', ondestroy)
    }
  })
}
