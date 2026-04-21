import {describe, expect, it, vi, beforeEach} from 'vitest'
import {lookupAppId} from '../src/utils/lookup-app-id'
import {fetchJson} from '../src/utils/http'

vi.mock('../src/utils/http', () => ({
  fetchJson: vi.fn()
}))

const fetchJsonMock = vi.mocked(fetchJson)

describe('lookupAppId', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
  })

  it('returns the id when a single app matches', async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{id: '123', attributes: {bundleId: 'com.example.app'}}]
    })

    const id = await lookupAppId('com.example.app', 'token')
    expect(id).toBe('123')
    expect(fetchJsonMock).toHaveBeenCalled()
  })

  it('throws when no app is found', async () => {
    fetchJsonMock.mockResolvedValue({data: []})
    await expect(lookupAppId('missing', 'token')).rejects.toThrow(
      /Unable to find App Store Connect app/
    )
  })

  it('throws when multiple apps match', async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {id: '123', attributes: {bundleId: 'com.example.app'}},
        {id: '456', attributes: {bundleId: 'com.example.app'}}
      ]
    })

    await expect(lookupAppId('com.example.app', 'token')).rejects.toThrow(
      /Multiple apps/
    )
  })
})
