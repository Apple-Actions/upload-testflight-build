import {describe, expect, it, vi} from 'vitest'
import {fetchJson} from '../src/utils/http'
import {
  lookupBuildState,
  waitForBuildProcessing
} from '../src/utils/buildLookup'

vi.mock('../src/utils/http', () => ({
  fetchJson: vi.fn()
}))

const fetchJsonMock = vi.mocked(fetchJson)

describe('lookupBuildState', () => {
  it('returns processing state when present', async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{attributes: {processingState: 'PROCESSING'}}]
    })

    const state = await lookupBuildState({
      appId: '123',
      buildNumber: '1',
      platform: 'IOS',
      token: 'token'
    })

    expect(state).toBe('PROCESSING')
    expect(fetchJsonMock).toHaveBeenCalled()
  })

  it('returns undefined when no data', async () => {
    fetchJsonMock.mockResolvedValue({data: []})

    const state = await lookupBuildState({
      appId: '123',
      buildNumber: '1',
      platform: 'IOS',
      token: 'token'
    })

    expect(state).toBeUndefined()
  })
})

describe('waitForBuildProcessing', () => {
  it('fails immediately when processingState is INVALID', async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{attributes: {processingState: 'INVALID'}}]
    })

    await expect(
      waitForBuildProcessing(
        {
          appId: '123',
          buildNumber: '14',
          platform: 'IOS',
          token: 'token'
        },
        {
          visibilityAttempts: 5,
          visibilityDelayMs: 1,
          processingAttempts: 5,
          processingDelayMs: 1
        }
      )
    ).rejects.toThrow(
      'Build 14 reached terminal processingState=INVALID in App Store Connect.'
    )

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
  })

  it('fails immediately when processingState is FAILED during processing wait', async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [{attributes: {processingState: 'PROCESSING'}}]
      })
      .mockResolvedValueOnce({
        data: [{attributes: {processingState: 'FAILED'}}]
      })

    await expect(
      waitForBuildProcessing(
        {
          appId: '123',
          buildNumber: '14',
          platform: 'IOS',
          token: 'token'
        },
        {
          visibilityAttempts: 5,
          visibilityDelayMs: 1,
          processingAttempts: 5,
          processingDelayMs: 1
        }
      )
    ).rejects.toThrow(
      'Build 14 reached terminal processingState=FAILED in App Store Connect.'
    )

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  it('resolves when the build becomes VALID', async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [{attributes: {processingState: 'PROCESSING'}}]
      })
      .mockResolvedValueOnce({
        data: [{attributes: {processingState: 'VALID'}}]
      })

    await waitForBuildProcessing(
      {
        appId: '123',
        buildNumber: '14',
        platform: 'IOS',
        token: 'token'
      },
      {
        visibilityAttempts: 5,
        visibilityDelayMs: 1,
        processingAttempts: 5,
        processingDelayMs: 1
      }
    )

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })
})
