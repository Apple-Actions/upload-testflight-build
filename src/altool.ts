import * as path from 'path'
import * as io from '@actions/io'
import * as fs from 'fs'
import * as exec from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'

/**
 Upload the specified application.
 @param appPath The path to the app to upload.
 @param appType The type of app to upload (osx | ios | appletvos)
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

  await exec.exec('xcrun', args, options)
}

function privateKeysPath(): string {
  const home: string = process.env['HOME'] || ''
  if (home === '') {
    throw new Error('Unable to determine user HOME path')
  }
  return path.join(home, 'private_keys')
}

export async function installPrivateKey(
  apiKeyId: string,
  apiPrivateKey: string
): Promise<void> {
  await io.mkdirP(privateKeysPath())
  fs.writeFileSync(
    path.join(privateKeysPath(), `AuthKey_${apiKeyId}.p8`),
    apiPrivateKey
  )
}

export async function deleteAllPrivateKeys(): Promise<void> {
  await io.rmRF(privateKeysPath())
}
