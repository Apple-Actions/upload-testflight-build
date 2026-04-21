import {beforeEach, describe, expect, it, vi} from 'vitest'
import {buildPlatform, fetchJson} from '../src/utils/http'

const fetchMock = vi.fn()
global.fetch = fetchMock

describe('http helpers additional coverage', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('normalizes leading slash paths when building URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ok: true}), {
        status: 200,
        headers: {'content-type': 'application/json'}
      })
    )

    await fetchJson('/some/path', 'token', 'error')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callUrl = fetchMock.mock.calls[0][0] as URL
    expect(callUrl.toString()).toBe(
      'https://api.appstoreconnect.apple.com/v1/some/path'
    )
  })

  it('returns empty object when response is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('plain text', {
        status: 200,
        headers: {'content-type': 'text/plain'}
      })
    )

    const result = await fetchJson('/text', 'token', 'error')
    expect(result).toEqual({})
  })

  it('maps app types to ASC platforms', () => {
    expect(buildPlatform('macos')).toBe('MAC_OS')
    expect(buildPlatform('appletvos')).toBe('TV_OS')
    expect(buildPlatform('visionos')).toBe('VISION_OS')
    expect(buildPlatform('ios')).toBe('IOS')
    // fallback default
    expect(buildPlatform('')).toBe('IOS')
  })
})
