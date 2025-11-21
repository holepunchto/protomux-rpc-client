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

  await t.exception(queued, /CONCURRENT_LIMITER_DESTROYED:/)

  t.is(await hold, 'held', 'the first execution should still be held')
})

test('queued execution aborts when abortSignalPromise rejects while waiting', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 1 })

  // Occupy the single slot for a while
  const hold = limiter.execute(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return 'held'
  })

  const abortSignal = new Signal()

  // This call will queue and should abort before it ever runs
  const queued = limiter.execute(async () => {
    t.fail('queued fn should not run')
  }, { abortSignalPromise: abortSignal.wait() })

  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_WAITING')), 50)

  await t.exception(queued, /ABORTED_TEST_WAITING/)
  t.is(await hold, 'held', 'first execution still completes')
})

test('running execution aborts when abortSignalPromise rejects during execution will not release the slot', async function (t) {
  const limiter = new ConcurrentLimiter({ maxConcurrent: 1 })

  const abortSignal = new Signal()

  // Start a long-running task and abort during execution
  const longRunning = limiter.execute(async () => {
    await new Promise((resolve) => { setTimeout(() => resolve(), 500) })
    return 'long'
  }, { abortSignalPromise: abortSignal.wait() })

  let queuedFinished = false
  limiter.execute(async () => {
    queuedFinished = true
  })

  // abort during the long running task execution
  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_RUNNING')), 50)

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.is(queuedFinished, false, 'abort the long running task will not release the slot')

  t.is(await longRunning, 'long', 'the long running task should not be aborted')

  await new Promise((resolve) => setTimeout(resolve, 50))

  t.is(queuedFinished, true, 'The slot is released after abort so queued can finish')
})
