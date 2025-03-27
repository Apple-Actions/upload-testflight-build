import {join} from 'path'
import {mkdirP, rmRF} from '@actions/io'
import {writeFileSync} from 'fs'
import {exec} from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'

/**
 Upload the specified application.
 @param appPath The path to the app to upload.
 @param appType The type of app to upload (macos | ios | appletvos | visionos)
 @param apiKeyId The id of the API key to use (private key must already be installed)
 @param issuerId The issuer identifier of the API key.
 @param options (Optional) Command execution options.
 */
export async function uploadApp(
  appPath: string,
  appType: string,
  apiKeyId: string,
  issuerId: string,
  options?: ExecOptions
): Promise<void> {
  const args: string[] = [
    'altool',
    '--output-format',
    'xml',
    '--upload-app',
    '--file',
    appPath,
    '--type',
    appType,
    '--apiKey',
    apiKeyId,
    '--apiIssuer',
    issuerId
  ]

  await exec('xcrun', args, options)
}

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
