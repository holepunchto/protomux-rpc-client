const test = require('brittle')
const BucketRateLimiter = require('../lib/bucket-rate-limiter')
const Signal = require('signal-promise')

test('consumes capacity immediately then waits for refill', async function (t) {
  const rateLimiter = new BucketRateLimiter({
    capacity: 2,
    tokensPerInterval: 1,
    intervalMs: 100
  })

  let a = null
  let b = null
  let c = null

  rateLimiter.execute(async () => (a = 'a'))
  rateLimiter.execute(async () => (b = 'b'))
  rateLimiter.execute(async () => (c = 'c'))

  await new Promise((resolve) => setTimeout(resolve, 60))

  t.is(a, 'a')
  t.is(b, 'b')
  t.is(c, null)

  // Refill happens at 100ms, expect p3 to complete after that
  await new Promise((resolve) => setTimeout(resolve, 40))

  t.is(c, 'c')

  rateLimiter.destroy()
})

test('refill does not exceed capacity across many intervals', async function (t) {
  const rateLimiter = new BucketRateLimiter({
    capacity: 2,
    tokensPerInterval: 5,
    intervalMs: 500
  })

  // Drain initial capacity
  t.is(await rateLimiter.execute(async () => 'x1'), 'x1')
  t.is(await rateLimiter.execute(async () => 'x2'), 'x2')

  // Advance many intervals; tokens should cap at capacity (2)
  await new Promise((resolve) => setTimeout(resolve, 1100))

  // Two immediate executions should proceed without waiting
  let y1 = null
  let y2 = null
  let y3 = null
  rateLimiter.execute(async () => {
    y1 = 'y1'
  })
  rateLimiter.execute(async () => {
    y2 = 'y2'
  })
  rateLimiter.execute(async () => {
    y3 = 'y3'
  })

  await new Promise((resolve) => setTimeout(resolve, 50))

  t.is(y1, 'y1')
  t.is(y2, 'y2')
  t.is(y3, null)

  await new Promise((resolve) => setTimeout(resolve, 500))

  t.is(y3, 'y3')

  rateLimiter.destroy()
})

test('queued execution aborts when abortSignalPromise rejects while waiting', async function (t) {
  const rateLimiter = new BucketRateLimiter({
    capacity: 1,
    tokensPerInterval: 1,
    intervalMs: 200
  })

  // Occupy the only token for a while
  const hold = rateLimiter.execute(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return 'held'
  })

  const abortSignal = new Signal()

  // This execution should queue and abort before any refill
  const queued = rateLimiter.execute(async () => {
    t.fail('queued fn should not run')
  }, { abortSignalPromise: abortSignal.wait() })

  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_WAITING')), 50)

  await t.exception(queued, /ABORTED_TEST_WAITING/)
  t.is(await hold, 'held')

  rateLimiter.destroy()
})

test('running execution abort signal during execution does not advance token availability', async function (t) {
  const rateLimiter = new BucketRateLimiter({
    capacity: 1,
    tokensPerInterval: 1,
    intervalMs: 1000
  })

  const abortSignal = new Signal()

  // Start a long-running task and "abort" during execution
  const longRunning = rateLimiter.execute(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return 'long'
  }, { abortSignalPromise: abortSignal.wait() })

  let queuedFinished = false
  rateLimiter.execute(async () => {
    queuedFinished = true
  })

  // Abort while longRunning is in progress; it should not cancel it
  setTimeout(() => abortSignal.notify(new Error('ABORTED_TEST_RUNNING')), 50)

  // Before first refill, queued should not have progressed
  await new Promise((resolve) => setTimeout(resolve, 400))
  t.is(queuedFinished, false, 'no refill yet, queued should still be waiting')

  t.is(await longRunning, 'long', 'long running task should complete unaffected by abort')

  // After the first refill interval elapses, queued should proceed
  await new Promise((resolve) => setTimeout(resolve, 700))
  t.is(queuedFinished, true, 'queued runs after next refill, not due to abort')

  rateLimiter.destroy()
})
