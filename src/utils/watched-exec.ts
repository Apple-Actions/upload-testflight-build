import {spawn} from 'node:child_process'
import {info} from '@actions/core'

export type StuckReason = 'retry-loop' | 'timeout'

export type WatchedExecResult = {
  exitCode: number
  stuckReason?: StuckReason
  buildUploadId?: string
}

export type WatchedExecOptions = {
  timeoutMs?: number
  maxPartRetries?: number
  killGraceMs?: number
  drainMs?: number
}

const DEFAULT_MAX_PART_RETRIES = 50
const DEFAULT_KILL_GRACE_MS = 10_000
const DEFAULT_DRAIN_MS = 2_000
const RETRY_PART_PATTERN = /WILL RETRY PART (\d+)/
const BUILD_UPLOAD_ID_PATTERN = /Received buildUploads ID: ([0-9a-f-]{36})/i
const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

export async function watchedExec(
  command: string,
  args: string[],
  options: WatchedExecOptions = {}
): Promise<WatchedExecResult> {
  const maxPartRetries = options.maxPartRetries ?? DEFAULT_MAX_PART_RETRIES
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  const drainMs = options.drainMs ?? DEFAULT_DRAIN_MS

  info(`[command]${[command, ...args].join(' ')}`)

  return new Promise<WatchedExecResult>((resolve, reject) => {
    // altool runs as launcher -> uploader -> `log stream`, so signals must go
    // to the whole process group rather than just the spawned pid.
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    })
    const retriesByPart = new Map<string, number>()
    let stuckReason: StuckReason | undefined
    let buildUploadId: string | undefined
    let exitCode: number | undefined
    let settled = false
    let timeoutTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined
    let drainTimer: NodeJS.Timeout | undefined

    const signalGroup = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid === undefined) throw new Error('no pid')
        process.kill(-child.pid, signal)
      } catch {
        child.kill(signal)
      }
    }

    const kill = (reason: StuckReason): void => {
      if (stuckReason) return
      stuckReason = reason
      signalGroup('SIGTERM')
      killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs)
    }

    const forwardSignal = (signal: NodeJS.Signals): void => {
      signalGroup(signal)
      process.exit(1)
    }

    const cleanup = (): void => {
      clearTimeout(timeoutTimer)
      clearTimeout(killTimer)
      clearTimeout(drainTimer)
      for (const signal of FORWARDED_SIGNALS) {
        process.removeListener(signal, forwardSignal)
      }
    }

    const finish = (): void => {
      if (settled) return
      settled = true
      cleanup()
      child.stdout.destroy()
      child.stderr.destroy()
      resolve({exitCode: exitCode ?? 1, stuckReason, buildUploadId})
    }

    const onLine = (line: string): void => {
      const idMatch = BUILD_UPLOAD_ID_PATTERN.exec(line)
      if (idMatch) buildUploadId = idMatch[1]

      const match = RETRY_PART_PATTERN.exec(line)
      if (!match) return
      const retries = (retriesByPart.get(match[1]) ?? 0) + 1
      retriesByPart.set(match[1], retries)
      if (retries >= maxPartRetries) {
        kill('retry-loop')
      }
    }

    const watchStream = (
      stream: NodeJS.ReadableStream,
      sink: NodeJS.WriteStream
    ): void => {
      let buffered = ''
      stream.on('data', (chunk: Buffer) => {
        sink.write(chunk)
        buffered += chunk.toString()
        const lines = buffered.split(/\r?\n/)
        buffered = lines.pop() ?? ''
        for (const line of lines) onLine(line)
      })
      stream.on('end', () => {
        if (buffered !== '') onLine(buffered)
      })
    }

    watchStream(child.stdout, process.stdout)
    watchStream(child.stderr, process.stderr)

    for (const signal of FORWARDED_SIGNALS) {
      process.once(signal, forwardSignal)
    }

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => kill('timeout'), options.timeoutMs)
    }

    child.on('error', error => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })

    child.on('exit', code => {
      exitCode = code ?? 1
      if (stuckReason) signalGroup('SIGKILL')
      drainTimer = setTimeout(finish, drainMs)
    })

    child.on('close', code => {
      exitCode ??= code ?? 1
      finish()
    })
  })
}
