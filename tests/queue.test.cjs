// The per-connection job queue: ordering, isolation between keys, failure handling, multi-key locking.
const assert = require('node:assert/strict')
const { KeyedQueue } = require('./.build/queue.cjs')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const q = new KeyedQueue()

  // jobs for one key never overlap and keep their submission order
  const log = []
  let running = 0
  let maxRunning = 0
  const job = (name, ms) => async () => {
    running++
    maxRunning = Math.max(maxRunning, running)
    log.push(`start ${name}`)
    await sleep(ms)
    log.push(`end ${name}`)
    running--
    return name
  }
  const results = await Promise.all([q.run('a', job('1', 40)), q.run('a', job('2', 5)), q.run('a', job('3', 20))])
  assert.deepEqual(results, ['1', '2', '3'])
  assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3'])
  assert.equal(maxRunning, 1)
  console.log('serial per key OK')

  // different keys run in parallel
  const started = Date.now()
  await Promise.all([q.run('x', () => sleep(80)), q.run('y', () => sleep(80))])
  assert.ok(Date.now() - started < 150, 'two connections must not wait for each other')
  console.log('parallel across keys OK')

  // a failing job rejects its own caller but does not block the next one
  const failing = q.run('f', async () => {
    throw new Error('boom')
  })
  const after = q.run('f', async () => 'still runs')
  await assert.rejects(failing, /boom/)
  assert.equal(await after, 'still runs')
  console.log('failure isolation OK')

  // a transaction-like job is not interleaved by later submissions
  const trace = []
  const tx = q.run('db', async () => {
    trace.push('BEGIN')
    await sleep(30)
    trace.push('INSERT')
    await sleep(30)
    trace.push('COMMIT')
  })
  await sleep(5)
  const other = q.run('db', async () => trace.push('OTHER QUERY'))
  await Promise.all([tx, other])
  assert.deepEqual(trace, ['BEGIN', 'INSERT', 'COMMIT', 'OTHER QUERY'])
  console.log('other queries wait for a running transaction OK')

  // runAll holds every key; crossed pairs cannot deadlock
  const order = []
  const t1 = q.runAll(['b', 'a'], async () => (order.push('t1 in'), await sleep(30), order.push('t1 out')))
  const t2 = q.runAll(['a', 'b'], async () => (order.push('t2 in'), await sleep(10), order.push('t2 out')))
  const solo = q.run('a', async () => order.push('solo'))
  await Promise.all([t1, t2, solo])
  assert.deepEqual(order, ['t1 in', 't1 out', 't2 in', 't2 out', 'solo'])
  assert.equal(await q.runAll(['same', 'same'], async () => 'dedup'), 'dedup', 'duplicate keys are taken once')
  console.log('runAll (sorted acquisition, no deadlock) OK')

  assert.equal(q.tails.size <= 1, true, 'idle keys are cleaned up')
  console.log('ALL QUEUE TESTS PASSED')
})().catch((e) => {
  console.error('FAIL', e)
  process.exit(1)
})
