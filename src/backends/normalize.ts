import {UploadBackend} from './types'

export function normalizeBackend(value: string): UploadBackend {
  const normalized = value.toLowerCase() as UploadBackend
  if (
    normalized === 'appstore-api' ||
    normalized === 'transporter' ||
    normalized === 'altool'
  ) {
    return normalized
  }

  throw new Error(
    `Invalid backend '${value}'. Allowed values: appstore-api | transporter | altool.`
  )
}
