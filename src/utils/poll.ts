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

async function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs)
  })
}
