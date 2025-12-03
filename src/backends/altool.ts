import {exec, ExecOptions} from '@actions/exec'
import {UploadParams, UploadResult, Uploader} from './types'

export const altool: Uploader = {
  async upload(
    params: UploadParams,
    execOptions?: ExecOptions
  ): Promise<UploadResult> {
    const args: string[] = [
      '--upload-app',
      '--file',
      params.appPath,
      '--type',
      params.appType,
      '--apiKey',
      params.apiKeyId,
      '--apiIssuer',
      params.issuerId,
      '--verbose'
    ]

    await exec('xcrun', ['altool', ...args], execOptions)
    return {backend: 'altool', log: execOptions ? '' : undefined}
  }
}
