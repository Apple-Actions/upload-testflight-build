import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {watchedExec} from '../src/utils/watched-exec'

vi.mock('@actions/core', () => ({info: vi.fn()}))
vi.mock('node:child_process', () => ({spawn: vi.fn()}))

const spawnMock = vi.mocked(spawn)

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn()
  })
  spawnMock.mockReturnValueOnce(child as never)
  return child
}

const retryLine = (part: number): string =>
  `ERROR: [ContentDelivery.Uploader] WILL RETRY PART ${part}. Checksums do not match.\n`

async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

describe('watchedExec', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('passes through a clean exit', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])

    child.stdout.write('UPLOAD SUCCEEDED\n')
    await flush()
    child.emit('close', 0)

    await expect(result).resolves.toEqual({
      exitCode: 0,
      stuckReason: undefined
    })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills the process when one part keeps retrying', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 3})

    child.stderr.write(`${retryLine(1)}LOST 98451 bytes for part 1.\n`)
    child.stderr.write(retryLine(1))
    await flush()
    expect(child.kill).not.toHaveBeenCalled()

    child.stderr.write(retryLine(1))
    await flush()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    child.emit('close', null)
    await expect(result).resolves.toEqual({
      exitCode: 1,
      stuckReason: 'retry-loop'
    })
  })

  it('counts retries per part', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 3})

    child.stdout.write(retryLine(1) + retryLine(2) + retryLine(1))
    child.stdout.write(retryLine(2) + retryLine(3))
    await flush()
    expect(child.kill).not.toHaveBeenCalled()

    child.emit('close', 0)
    await expect(result).resolves.toEqual({
      exitCode: 0,
      stuckReason: undefined
    })
  })

  it('detects retry lines split across chunks', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 1})

    child.stdout.write('ERROR: WILL RETRY PA')
    child.stdout.write('RT 1. Checksums do not match.\n')
    await flush()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    child.emit('close', null)
    await expect(result).resolves.toMatchObject({stuckReason: 'retry-loop'})
  })

  it('kills the process on timeout and escalates to SIGKILL', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {
      timeoutMs: 1000,
      killGraceMs: 500
    })

    vi.advanceTimersByTime(1000)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(500)
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')

    child.emit('close', null)
    await expect(result).resolves.toEqual({
      exitCode: 1,
      stuckReason: 'timeout'
    })
  })

  it('rejects when the process cannot be spawned', async () => {
    const child = fakeChild()
    const result = watchedExec('missing', [])

    child.emit('error', new Error('spawn missing ENOENT'))

    await expect(result).rejects.toThrow('spawn missing ENOENT')
  })
})
