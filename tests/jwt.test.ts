import {describe, it, expect} from 'vitest'
import {generateJwt} from '../src/auth/jwt'

type JwtParts = {
  header: Record<string, unknown>
  payload: Record<string, unknown>
}

function decode(jwt: string): JwtParts {
  const [headerB64, payloadB64] = jwt.split('.')
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
  return {header, payload}
}

describe('generateJwt', () => {
  it('produces a signed token with expected fields', () => {
    const jwt = generateJwt('issuer-123', 'kid-abc', TEST_KEY)
    const parts = decode(jwt)

    expect(parts.header).toMatchObject({
      alg: 'ES256',
      kid: 'kid-abc',
      typ: 'JWT'
    })
    expect(parts.payload).toMatchObject({
      iss: 'issuer-123',
      aud: 'appstoreconnect-v1'
    })
    expect(typeof parts.payload.exp).toBe('number')
    expect(typeof parts.payload.iat).toBe('number')
  })
})

// Test private key: throwaway P-256 key for unit testing only
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgY93aAlLL8vltp9GV
lwbgmBWVeadWcCioQgw4BleKnQChRANCAAR9za6Su0+ARoC2Za69gfp3GRLV0FrN
4sWFH/IFcp37hLNIgDPO9r6xDTeR2qWaYXw9sj2qGq9QKD+CiubSKIaT
-----END PRIVATE KEY-----`
