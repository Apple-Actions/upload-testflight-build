import {basename} from 'path'
import {statSync, promises as fs} from 'fs'
import {warning, info} from '@actions/core'
import {UploadParams, UploadResult, Uploader} from './types'
import {generateJwt} from '../auth/jwt'
import {buildPlatform, fetchJson} from '../http'
import {pollUntil} from '../poll'
import {extractAppMetadata} from '../appMetadata'

const MAX_PROCESSING_ATTEMPTS = 20
const PROCESSING_DELAY_MS = 30000
const VISIBILITY_ATTEMPTS = 10
const VISIBILITY_DELAY_MS = 10000

export const appStoreApiBackend: Uploader = {
  async upload(params: UploadParams): Promise<UploadResult> {
    const token = generateJwt(
      params.issuerId,
      params.apiKeyId,
      params.apiPrivateKey
    )
    const metadata = await extractAppMetadata(params.appPath)

    const platform = buildPlatform(params.appType)
    const fileName = basename(params.appPath)
    const fileSize = statSync(params.appPath).size

    const buildUpload = await createBuildUpload({
      bundleId: metadata.bundleId,
      platform,
      fileName,
      fileSize,
      token
    })

    await performUpload(buildUpload, params.appPath)
    await completeBuildUpload(buildUpload.id, token)

    await pollBuildProcessing({
      bundleId: metadata.bundleId,
      buildNumber: metadata.buildNumber,
      platform,
      token
    })

    return {backend: 'appstore-api', raw: buildUpload}
  }
}

type BuildUpload = {
  id: string
  uploadOperations: UploadOperation[]
}

type UploadOperation = {
  method: string
  url: string
  offset: number
  length: number
  requestHeaders?: Array<{name: string; value: string}>
}

async function createBuildUpload(params: {
  bundleId: string
  platform: string
  fileName: string
  fileSize: number
  token: string
}): Promise<BuildUpload> {
  const payload = {
    data: {
      type: 'buildUploads',
      attributes: {
        bundleId: params.bundleId,
        platform: params.platform,
        fileName: params.fileName,
        fileSize: params.fileSize
      }
    }
  }

  const response = await fetchJson<{
    data: {
      id: string
      attributes: {
        uploadOperations: UploadOperation[]
      }
    }
  }>(
    '/buildUploads',
    params.token,
    'Failed to create App Store build upload.',
    'POST',
    payload
  )

  const uploadOperations = response.data.attributes.uploadOperations
  if (!uploadOperations || uploadOperations.length === 0) {
    throw new Error('App Store API returned no upload operations.')
  }

  return {
    id: response.data.id,
    uploadOperations
  }
}

async function performUpload(
  upload: BuildUpload,
  appPath: string
): Promise<void> {
  const buffer = await fs.readFile(appPath)

  for (const operation of upload.uploadOperations) {
    const slice = buffer.subarray(
      operation.offset,
      operation.offset + operation.length
    )

    const headers: Record<string, string> = {}
    if (operation.requestHeaders) {
      for (const header of operation.requestHeaders) {
        headers[header.name] = header.value
      }
    }

    const response = await fetch(operation.url, {
      method: operation.method,
      headers,
      body: slice
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `Failed to upload build chunk (status ${response.status}): ${text}`
      )
    }
  }
}

async function completeBuildUpload(
  uploadId: string,
  token: string
): Promise<void> {
  await fetchJson(
    `/buildUploads/${uploadId}/complete`,
    token,
    'Failed to finalize App Store build upload.',
    'POST'
  )
}

async function pollBuildProcessing(params: {
  bundleId: string
  buildNumber: string
  platform: string
  token: string
}): Promise<void> {
  await pollUntil(
    () => lookupBuildState(params),
    state => state === 'VALID' || state === 'PROCESSING',
    {
      attempts: VISIBILITY_ATTEMPTS,
      delayMs: VISIBILITY_DELAY_MS,
      onRetry: attempt => {
        warning(
          `Waiting for build ${params.buildNumber} to appear in App Store Connect (attempt ${
            attempt + 1
          }/${VISIBILITY_ATTEMPTS}).`
        )
      }
    }
  )

  await pollUntil(
    () => lookupBuildState(params),
    state => state === 'VALID',
    {
      attempts: MAX_PROCESSING_ATTEMPTS,
      delayMs: PROCESSING_DELAY_MS,
      onRetry: attempt => {
        warning(
          `Build processing pending (attempt ${attempt + 1}/${MAX_PROCESSING_ATTEMPTS}).`
        )
      }
    }
  )

  info('Build upload completed and processing is VALID.')
}

async function lookupBuildState(params: {
  bundleId: string
  buildNumber: string
  platform: string
  token: string
}): Promise<string | undefined> {
  const query = new URLSearchParams()
  query.set('filter[bundleId]', params.bundleId)
  query.set('filter[version]', params.buildNumber)
  query.set('filter[preReleaseVersion.platform]', params.platform)

  const response = await fetchJson<{
    data?: Array<{attributes?: {processingState?: string}}>
  }>(
    `/builds?${query.toString()}`,
    params.token,
    'Failed to query builds for processing state.'
  )

  return response.data?.[0]?.attributes?.processingState
}
