import {createSign} from 'crypto'

export function generateJwt(
  issuerId: string,
  apiKeyId: string,
  apiPrivateKey: string,
  ttlSeconds = 600
): string {
  const header = {
    alg: 'ES256',
    kid: apiKeyId,
    typ: 'JWT'
  }

  const now = Math.floor(Date.now() / 1000)

  const payload = {
    iss: issuerId,
    aud: 'appstoreconnect-v1',
    iat: now - 60,
    exp: now + ttlSeconds
  }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url'
  )
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  )
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const signer = createSign('SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign({
    key: apiPrivateKey,
    dsaEncoding: 'ieee-p1363'
  })

  const encodedSignature = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${encodedSignature}`
}
