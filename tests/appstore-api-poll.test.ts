import {describe, expect, it, vi} from 'vitest'
import {fetchJson} from '../src/utils/http'
import {lookupBuildState} from '../src/utils/buildLookup'

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
