import {ExecOptions} from '@actions/exec'

export type UploadBackend = 'appstore-api' | 'transporter' | 'altool'

export type UploadParams = {
  appPath: string
  appType: string
  apiKeyId: string
  issuerId: string
  apiPrivateKey: string
}

export type UploadResult = {
  backend: UploadBackend
  raw?: unknown
  log?: string
}

export interface Uploader {
  upload(params: UploadParams, execOptions?: ExecOptions): Promise<UploadResult>
}

export type UploadFactory = Record<UploadBackend, Uploader>
