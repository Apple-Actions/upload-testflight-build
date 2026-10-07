import {spawn} from 'node:child_process'
import {info} from '@actions/core'

export type StuckReason = 'retry-loop' | 'timeout'

export type WatchedExecResult = {
  exitCode: number
  stuckReason?: StuckReason
}

export type WatchedExecOptions = {
  timeoutMs?: number
  maxPartRetries?: number
  killGraceMs?: number
}

const DEFAULT_MAX_PART_RETRIES = 50
const DEFAULT_KILL_GRACE_MS = 10_000
const RETRY_PART_PATTERN = /WILL RETRY PART (\d+)/

export async function watchedExec(
  command: string,
  args: string[],
  options: WatchedExecOptions = {}
): Promise<WatchedExecResult> {
  const maxPartRetries = options.maxPartRetries ?? DEFAULT_MAX_PART_RETRIES
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS

  info(`[command]${[command, ...args].join(' ')}`)

  return new Promise<WatchedExecResult>((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']})
    const retriesByPart = new Map<string, number>()
    let stuckReason: StuckReason | undefined
    let timeoutTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    const kill = (reason: StuckReason): void => {
      if (stuckReason) return
      stuckReason = reason
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs)
    }

    const onLine = (line: string): void => {
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

    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => kill('timeout'), options.timeoutMs)
    }

    const clearTimers = (): void => {
      clearTimeout(timeoutTimer)
      clearTimeout(killTimer)
    }

    child.on('error', error => {
      clearTimers()
      reject(error)
    })

    child.on('close', code => {
      clearTimers()
      resolve({exitCode: code ?? 1, stuckReason})
    })
  })
}
