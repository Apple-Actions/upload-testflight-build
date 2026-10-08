import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {spawn} from 'node:child_process'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {watchedExec} from '../src/utils/watched-exec'

vi.mock('@actions/core', () => ({info: vi.fn()}))
vi.mock('node:child_process', () => ({spawn: vi.fn()}))

const spawnMock = vi.mocked(spawn)
const PID = 4321

type FakeChild = EventEmitter & {
  pid: number
  stdout: PassThrough
  stderr: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = Object.assign(new EventEmitter(), {
    pid: PID,
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
  let killMock: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    killMock = vi.spyOn(process, 'kill').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('spawns the command in its own process group', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])

    expect(spawnMock).toHaveBeenCalledWith('xcrun', ['altool'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })

    child.emit('exit', 0)
    child.emit('close', 0)
    await result
  })

  it('passes through a clean exit', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])

    child.stdout.write('UPLOAD SUCCEEDED\n')
    await flush()
    child.emit('exit', 0)
    child.emit('close', 0)

    await expect(result).resolves.toEqual({
      exitCode: 0,
      stuckReason: undefined,
      buildUploadId: undefined
    })
    expect(killMock).not.toHaveBeenCalled()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills the process group when one part keeps retrying', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 3})

    child.stderr.write(`${retryLine(1)}LOST 98451 bytes for part 1.\n`)
    child.stderr.write(retryLine(1))
    await flush()
    expect(killMock).not.toHaveBeenCalled()

    child.stderr.write(retryLine(1))
    await flush()
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGTERM')

    child.emit('exit', null)
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGKILL')
    child.emit('close', null)
    await expect(result).resolves.toMatchObject({
      exitCode: 1,
      stuckReason: 'retry-loop'
    })
  })

  it('falls back to killing the child when the group signal fails', async () => {
    killMock.mockImplementation(() => {
      throw new Error('ESRCH')
    })
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 1})

    child.stdout.write(retryLine(1))
    await flush()
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')

    child.emit('exit', null)
    child.emit('close', null)
    await result
  })

  it('counts retries per part', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {maxPartRetries: 3})

    child.stdout.write(retryLine(1) + retryLine(2) + retryLine(1))
    child.stdout.write(retryLine(2) + retryLine(3))
    await flush()
    expect(killMock).not.toHaveBeenCalled()

    child.emit('exit', 0)
    child.emit('close', 0)
    await expect(result).resolves.toMatchObject({
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
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGTERM')

    child.emit('exit', null)
    child.emit('close', null)
    await expect(result).resolves.toMatchObject({stuckReason: 'retry-loop'})
  })

  it('captures the buildUploads ID from altool output', async () => {
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])

    child.stdout.write(
      'DEBUG: [ContentDelivery.Uploader] Received buildUploads ID: 8d3f6ff2-0088-43c8-ad30-b0ac32761083\n'
    )
    await flush()
    child.emit('exit', 0)
    child.emit('close', 0)

    await expect(result).resolves.toMatchObject({
      buildUploadId: '8d3f6ff2-0088-43c8-ad30-b0ac32761083'
    })
  })

  it('resolves after exit even when a leftover process keeps the pipes open', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {drainMs: 500})

    child.emit('exit', 0)
    vi.advanceTimersByTime(500)

    await expect(result).resolves.toMatchObject({exitCode: 0})
    expect(child.stdout.destroyed).toBe(true)
    expect(child.stderr.destroyed).toBe(true)
  })

  it('kills the process group on timeout and escalates to SIGKILL', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'], {
      timeoutMs: 1000,
      killGraceMs: 500
    })

    vi.advanceTimersByTime(1000)
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGTERM')
    vi.advanceTimersByTime(500)
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGKILL')

    child.emit('exit', null)
    child.emit('close', null)
    await expect(result).resolves.toMatchObject({
      exitCode: 1,
      stuckReason: 'timeout'
    })
  })

  it('forwards a cancel signal to the process group', async () => {
    const exitMock = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])

    process.emit('SIGTERM', 'SIGTERM')
    expect(killMock).toHaveBeenCalledWith(-PID, 'SIGTERM')
    expect(exitMock).toHaveBeenCalledWith(1)

    child.emit('exit', null)
    child.emit('close', null)
    await result
  })

  it('removes its signal handlers once the process finishes', async () => {
    const before = process.listenerCount('SIGTERM')
    const child = fakeChild()
    const result = watchedExec('xcrun', ['altool'])
    expect(process.listenerCount('SIGTERM')).toBe(before + 1)

    child.emit('exit', 0)
    child.emit('close', 0)
    await result
    expect(process.listenerCount('SIGTERM')).toBe(before)
  })

  it('rejects when the process cannot be spawned', async () => {
    const child = fakeChild()
    const result = watchedExec('missing', [])

    child.emit('error', new Error('spawn missing ENOENT'))

    await expect(result).rejects.toThrow('spawn missing ENOENT')
  })
})
