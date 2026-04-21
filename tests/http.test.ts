import {describe, it, expect} from 'vitest'
import {buildPlatform} from '../src/utils/http'

describe('buildPlatform', () => {
  it('maps known platforms', () => {
    expect(buildPlatform('ios')).toBe('IOS')
    expect(buildPlatform('macos')).toBe('MAC_OS')
    expect(buildPlatform('appletvos')).toBe('TV_OS')
    expect(buildPlatform('visionos')).toBe('VISION_OS')
  })

  it('defaults to IOS', () => {
    expect(buildPlatform('unknown')).toBe('IOS')
  })
})
