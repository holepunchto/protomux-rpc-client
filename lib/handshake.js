const cenc = require('compact-encoding')

// copy from https://github.com/holepunchto/rpc/blob/main/spec/hyperschema/index.js
module.exports = {
  preencode (state, m) {
    state.end++
    if (m.capability) cenc.fixed32.preencode(state, m.capability)
  },
  encode (state, m) {
    const flags = m.capability ? 1 : 0
    cenc.uint.encode(state, flags)
    if (m.capability) cenc.fixed32.encode(state, m.capability)
  },
  decode (state) {
    const flags = cenc.uint.decode(state)
    return {
      capability: (flags & 1) !== 0 ? cenc.fixed32.decode(state) : null
    }
  }
}
