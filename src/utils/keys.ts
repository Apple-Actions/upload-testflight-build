import {join} from 'path'
import {mkdirP, rmRF} from '@actions/io'
import {writeFileSync} from 'fs'

function privateKeysPath(): string {
  const home: string = process.env['HOME'] || ''
  if (home === '') {
    throw new Error('Unable to determine user HOME path')
  }
  return join(home, 'private_keys')
}

export async function installPrivateKey(
  apiKeyId: string,
  apiPrivateKey: string
): Promise<void> {
  await mkdirP(privateKeysPath())
  writeFileSync(
    join(privateKeysPath(), `AuthKey_${apiKeyId}.p8`),
    apiPrivateKey
  )
}

export async function deleteAllPrivateKeys(): Promise<void> {
  await rmRF(privateKeysPath())
}
