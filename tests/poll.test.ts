import {describe, it, expect, vi} from 'vitest'
import {pollUntil, pollWithBackoff} from '../src/utils/poll'

describe('pollUntil', () => {
  it('resolves when predicate is satisfied', async () => {
    let attempts = 0
    const result = await pollUntil(
      async () => {
        attempts += 1
        return attempts === 2 ? 'done' : undefined
      },
      value => value === 'done',
      {attempts: 3, delayMs: 10}
    )

    expect(result).toBe('done')
    expect(attempts).toBe(2)
  })

  it('throws after max attempts', async () => {
    const start = Date.now()
    await expect(
      pollUntil(async () => undefined, Boolean, {attempts: 2, delayMs: 5})
    ).rejects.toThrow('Exceeded maximum attempts')
    expect(Date.now() - start).toBeGreaterThanOrEqual(10)
  })

  it('honors onRetry callback', async () => {
    const onRetry = vi.fn()
    await expect(
      pollUntil(async () => undefined, Boolean, {
        attempts: 2,
        delayMs: 1,
        onRetry
      })
    ).rejects.toThrow()

    expect(onRetry).toHaveBeenCalledTimes(2)
  })
})

describe('pollWithBackoff', () => {
  it('uses a timeoutError factory with the last value', async () => {
    await expect(
      pollWithBackoff(
        async () => 'PROCESSING',
        value => value === 'VALID',
        2,
        1,
        undefined,
        undefined,
        last => `gave up at ${last}`
      )
    ).rejects.toThrow('gave up at PROCESSING')
  })
})
