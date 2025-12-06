import {basename} from 'path'
import {statSync, promises as fs} from 'fs'
import {warning, info, debug} from '@actions/core'
import {UploadParams, UploadResult, Uploader} from './types'
import {generateJwt} from '../auth/jwt'
import {buildPlatform, fetchJson} from '../utils/http'
import {pollUntil} from '../utils/poll'
import {extractAppMetadata} from '../utils/appMetadata'
import {lookupAppId} from '../utils/lookup-app-id'

const MAX_PROCESSING_ATTEMPTS = 20
const PROCESSING_DELAY_MS = 30000
const VISIBILITY_ATTEMPTS = 10
const VISIBILITY_DELAY_MS = 10000

export const appstoreApi: Uploader = {
  async upload(params: UploadParams): Promise<UploadResult> {
    info('Starting App Store API upload backend.')
    const token = generateJwt(
      params.issuerId,
      params.apiKeyId,
      params.apiPrivateKey
    )
    const metadata = await extractAppMetadata(params.appPath)
    debug(
      `Extracted metadata: bundleId=${metadata.bundleId}, buildNumber=${metadata.buildNumber}, shortVersion=${metadata.shortVersion}`
    )

    const platform = buildPlatform(params.appType)
    const fileName = basename(params.appPath)
    const fileSize = statSync(params.appPath).size

    debug(
      `Preparing build upload for platform=${platform}, file=${fileName}, size=${fileSize} bytes`
    )

    const appId = await lookupAppId(metadata.bundleId, token)
    debug(`Resolved appId=${appId} for bundleId=${metadata.bundleId}`)

    const buildUpload = await createBuildUpload(
      {
        appId,
        platform,
        cfBundleShortVersionString: metadata.shortVersion,
        cfBundleVersion: metadata.buildNumber
      },
      token
    )
    debug(
      `Created build upload id=${buildUpload.id}, operations=${buildUpload.uploadOperations.length}`
    )

    await performUpload(buildUpload, params.appPath)
    info('Finished uploading build chunks.')
    await completeBuildUpload(buildUpload.id, token)
    info('Marked build upload as complete; waiting for processing.')

    await pollBuildProcessing({
      bundleId: metadata.bundleId,
      buildNumber: metadata.buildNumber,
      platform,
      token
    })

    return {backend: 'appstoreApi', raw: buildUpload}
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

async function createBuildUpload(
  params: {
    appId: string
    platform: string
    cfBundleShortVersionString: string
    cfBundleVersion: string
  },
  token: string
): Promise<BuildUpload> {
  const payload = {
    data: {
      type: 'buildUploads',
      attributes: {
        platform: params.platform,
        cfBundleShortVersionString: params.cfBundleShortVersionString,
        cfBundleVersion: params.cfBundleVersion
      },
      relationships: {
        app: {
          data: {
            type: 'apps',
            id: params.appId
          }
        }
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
    token,
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

  for (const [index, operation] of upload.uploadOperations.entries()) {
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

    debug(
      `Uploaded chunk ${index + 1}/${upload.uploadOperations.length} (${slice.length} bytes).`
    )
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

  const state = response.data?.[0]?.attributes?.processingState
  if (state) {
    debug(`Build processing state: ${state}`)
  }
  return state
}
