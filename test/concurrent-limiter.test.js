const test = require('brittle')
const ConcurrentLimiter = require('../lib/concurrent-limiter')
const Signal = require('signal-promise')

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

test('queued execution aborts when abortSignalPromise rejects while waiting', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 1 })

  // Occupy the single slot for a while
  const hold = limiter.execute(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return 'held'
  })

  const abortSignal = new Signal()
  let didRun = false

  // This call will queue and should abort before it ever runs
  const queued = limiter.execute(async () => {
    didRun = true
    return 'should-not-run'
  }, { abortSignalPromise: abortSignal.wait() })

  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_WAITING')), 50)

  await t.exception(queued, /ABORTED_TEST_WAITING/)
  t.is(didRun, false, 'queued fn never ran')
  t.is(await hold, 'held', 'first execution still completes')
})

test('running execution aborts when abortSignalPromise rejects during execution will release the slot', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 1 })

  const abortSignal = new Signal()

  // Start a long-running task and abort during execution
  const longRunning = limiter.execute(async () => {
    // never resolves
    await new Promise(() => {})
    return 'long'
  }, { abortSignalPromise: abortSignal.wait() })
  const queued = limiter.execute(async () => 'queue-ok')

  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_RUNNING')), 50)

  await t.exception(longRunning, /ABORTED_TEST_RUNNING/)

  // The slot is released after abort so queued can finish
  t.is(await queued, 'queue-ok')
})
