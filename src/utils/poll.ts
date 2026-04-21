export async function pollUntil<T>(
  action: () => Promise<T | undefined>,
  predicate: (value: T) => boolean,
  options: {
    attempts: number
    delayMs: number
    onRetry?: (attempt: number) => void
  }
): Promise<T> {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    const result = await action()
    if (result && predicate(result)) {
      return result
    }

    options.onRetry?.(attempt)
    await delay(options.delayMs)
  }

  throw new Error(
    'Exceeded maximum attempts while polling App Store Connect state.'
  )
}

export async function pollWithBackoff<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  attempts: number,
  initialDelayMs: number,
  onRetry?: (message: string) => void,
  backoffCapMs = 5 * 60 * 1000
): Promise<T> {
  let delayMs = initialDelayMs
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await fn()
    if (predicate(value)) return value
    if (attempt === attempts - 1) break
    const label = `attempt ${attempt + 1}/${attempts}; next retry in ${
      delayMs / 1000
    }s`
    onRetry?.(label)
    await delay(delayMs)
    delayMs = Math.min(delayMs * 2, backoffCapMs)
  }
  throw new Error('Timed out while polling App Store Connect state.')
}

async function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs)
  })
}
