import {UploadResult, UploadParams, Uploader} from './types'
import {uploadApp} from '../transporter'
import {ExecOptions} from '@actions/exec'

export const transporterBackend: Uploader = {
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
