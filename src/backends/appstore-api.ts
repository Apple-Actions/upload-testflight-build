import {basename} from 'path'
import {statSync, promises as fs} from 'fs'
import {warning, info, debug} from '@actions/core'
import {UploadParams, UploadResult, Uploader} from './types'
import {generateJwt} from '../auth/jwt'
import {buildPlatform, fetchJson} from '../utils/http'
import {extractAppMetadata} from '../utils/appMetadata'
import {lookupAppId} from '../utils/lookup-app-id'
import {waitForBuildProcessing} from '../utils/buildLookup'

const MAX_PROCESSING_ATTEMPTS = 10
const PROCESSING_DELAY_MS = 30000
const VISIBILITY_ATTEMPTS = 10
const VISIBILITY_DELAY_MS = 60000 // 1 minute initial wait before polling visibility

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
        cfBundleVersion: metadata.buildNumber,
        fileName,
        fileSize
      },
      token
    )
    debug(
      `Created build upload id=${buildUpload.id}, operations=${buildUpload.uploadOperations.length}`
    )

    await performUpload(buildUpload, params.appPath)
    info('Finished uploading build chunks.')
    await completeBuildUpload(buildUpload.fileId, token)
    info('Marked build upload as complete; waiting for processing.')

    if (params.waitForProcessing !== false) {
      await pollBuildProcessing({
        appId,
        buildNumber: metadata.buildNumber,
        platform,
        token
      })
    } else {
      info('Skipping wait for App Store processing per configuration.')
    }

    return {backend: 'appstoreApi', raw: buildUpload}
  }
}

type BuildUpload = {
  id: string
  fileId: string
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
    fileName: string
    fileSize: number
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
        uploadOperations?: UploadOperation[]
      }
    }
  }>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/build-uploads
    '/buildUploads',
    token,
    'Failed to create App Store build upload.',
    'POST',
    payload
  )

  const inlineOperations = response.data.attributes.uploadOperations ?? []
  let fileId: string | undefined
  let uploadOperations: UploadOperation[] = []

  if (inlineOperations.length > 0) {
    uploadOperations = inlineOperations
    // Still create a buildUploadFile to obtain the fileId required for commit.
    const created = await createBuildUploadFile(
      response.data.id,
      params.fileName,
      params.fileSize,
      token
    )
    fileId = created.fileId
    // If inline operations were empty for some reason, fall back to created ops.
    if (uploadOperations.length === 0) {
      uploadOperations = created.uploadOperations
    }
  } else {
    const created = await createBuildUploadFile(
      response.data.id,
      params.fileName,
      params.fileSize,
      token
    )
    fileId = created.fileId
    uploadOperations = created.uploadOperations
  }

  if (!uploadOperations || uploadOperations.length === 0 || !fileId) {
    throw new Error('App Store API returned no upload operations.')
  }

  return {
    id: response.data.id,
    fileId,
    uploadOperations
  }
}

async function createBuildUploadFile(
  uploadId: string,
  fileName: string,
  fileSize: number,
  token: string
): Promise<{fileId: string; uploadOperations: UploadOperation[]}> {
  const response = await fetchJson<{
    data?: {
      id: string
      attributes?: {uploadOperations?: UploadOperation[]}
    }
  }>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/build-upload-files
    '/buildUploadFiles',
    token,
    'Failed to create App Store build upload file.',
    'POST',
    {
      data: {
        type: 'buildUploadFiles',
        attributes: {
          fileName,
          fileSize,
          assetType: 'ASSET',
          uti: 'com.apple.ipa'
        },
        relationships: {
          buildUpload: {
            data: {
              type: 'buildUploads',
              id: uploadId
            }
          }
        }
      }
    }
  )

  if (!response.data?.id) {
    throw new Error('App Store API buildUploadFiles response missing id.')
  }

  return {
    fileId: response.data.id,
    uploadOperations: response.data.attributes?.uploadOperations ?? []
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
  fileId: string,
  token: string
): Promise<void> {
  await fetchJson(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/build-upload-files
    `/buildUploadFiles/${fileId}`,
    token,
    'Failed to finalize App Store build upload.',
    'PATCH',
    {
      data: {
        id: fileId,
        type: 'buildUploadFiles',
        attributes: {
          uploaded: true
        }
      }
    }
  )
}

async function pollBuildProcessing(params: {
  appId: string
  buildNumber: string
  platform: string
  token: string
}): Promise<void> {
  await waitForBuildProcessing(params, {
    visibilityAttempts: VISIBILITY_ATTEMPTS,
    visibilityDelayMs: VISIBILITY_DELAY_MS,
    processingAttempts: MAX_PROCESSING_ATTEMPTS,
    processingDelayMs: PROCESSING_DELAY_MS,
    onRetry: message =>
      warning(`Waiting for build ${params.buildNumber}: ${message}`)
  })

  info('Build upload completed and processing is VALID.')
}
