import {exec} from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'

/**
 Upload the specified application via iTMSTransporter.
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
    'iTMSTransporter',
    '-m',
    'upload',
    '-assetFile',
    appPath,
    '-apiKey',
    apiKeyId,
    '-apiIssuer',
    issuerId,
    '-v',
    'eXtreme'
  ]

  if (appType !== '') {
    args.push('-appPlatform', appType)
  }

  await exec('xcrun', args, options)
}
