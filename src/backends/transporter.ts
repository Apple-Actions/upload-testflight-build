import {exec} from '@actions/exec'
import {ExecOptions} from '@actions/exec/lib/interfaces'
import {UploadParams, UploadResult, Uploader} from './types'

export async function uploadApp(
  appPath: string,
  appType: string,
  apiKeyId: string,
  issuerId: string,
  transporterExecutablePath: string | undefined,
  options?: ExecOptions
): Promise<void> {
  const transporterBinary =
    transporterExecutablePath && transporterExecutablePath.trim().length > 0
      ? transporterExecutablePath.trim()
      : '/usr/local/itms/bin/iTMSTransporter'

  const args: string[] = [
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

  await exec(transporterBinary, args, options)
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
      params.transporterExecutablePath,
      execOptions
    )

    return {backend: 'transporter', log: execOptions ? '' : undefined}
  }
}
