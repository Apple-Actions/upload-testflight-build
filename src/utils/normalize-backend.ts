import {UploadBackend} from '../backends/types'

export function normalizeBackend(value: string): UploadBackend {
  const lower = value.toLowerCase()

  if (lower === 'appstoreapi' || lower === 'appstore-api') {
    return 'appstoreApi'
  }
  if (lower === 'transporter') {
    return 'transporter'
  }
  if (lower === 'altool') {
    return 'altool'
  }

  throw new Error(
    `Invalid backend '${value}'. Allowed values: appstoreApi | transporter | altool.`
  )
}
