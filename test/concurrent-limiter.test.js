const test = require('brittle')
const ConcurrentLimiter = require('../lib/concurrent-limiter')

test('processes up to maxConcurrent immediately then waits for release', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 2 })

  let a = null
  let b = null
  let c = null

  // First two start immediately and hold for a bit
  limiter.execute(async () => {
    a = 'a'
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  limiter.execute(async () => {
    b = 'b'
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  // Third should wait until one of the first two releases
  limiter.execute(async () => {
    c = 'c'
  })

  await new Promise((resolve) => setTimeout(resolve, 20))

  t.is(a, 'a')
  t.is(b, 'b')
  t.is(c, null)

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.is(c, 'c')
})

test('pending execution rejects if limiter destroyed while waiting', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 1 })

  // Occupy the single slot for a while
  const hold = limiter.execute(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return 'held'
  })

  // Next execution will be queued
  const queued = limiter.execute(async () => 'queued')

  // Destroy while the second is waiting
  limiter.destroy()

  // await new Promise((resolve) => setTimeout(resolve, 10))

  await t.exception(queued, /CONCURRENT_LIMITER_DESTROYED:/)

  // the first execution should still be held
  t.is(await hold, 'held')
})
