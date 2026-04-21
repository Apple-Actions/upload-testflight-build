import {describe, it, expect} from 'vitest'
import {normalizeBackend} from '../src/utils/normalize-backend'

describe('normalizeBackend', () => {
  it('accepts valid backends regardless of case', () => {
    expect(normalizeBackend('appstore-api')).toBe('appstoreApi')
    expect(normalizeBackend('APPSTOREAPI')).toBe('appstoreApi')
    expect(normalizeBackend('Transporter')).toBe('transporter')
    expect(normalizeBackend('ALTOOL')).toBe('altool')
  })

  it('throws for invalid values', () => {
    expect(() => normalizeBackend('foo')).toThrow(/Invalid backend/)
  })
})
