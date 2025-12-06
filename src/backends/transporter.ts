import {exec} from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import {UploadParams, UploadResult, Uploader} from './types'

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

export const transporter: Uploader = {
  async upload(
    params: UploadParams,
    execOptions?: ExecOptions
  ): Promise<UploadResult> {
    await uploadApp(
      params.appPath,
      params.appType,
      params.apiKeyId,
      params.issuerId,
      execOptions
    )

    return {backend: 'transporter', log: execOptions ? '' : undefined}
  }
}
