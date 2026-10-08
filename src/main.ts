import {getInput, setOutput, setFailed, info} from '@actions/core'
import {platform} from 'os'
import {prepareBuildMetadata, submitBuildMetadataUpdates} from './buildMetadata'
import {installPrivateKey, deleteAllPrivateKeys} from './utils/keys'
import {UploadFactory} from './backends/types'
import {transporter} from './backends/transporter'
import {altool} from './backends/altool'
import {appstoreApi} from './backends/appstore-api'
import {normalizeBackend} from './utils/normalize-backend'
import type {ExecOptions} from '@actions/exec'

function parsePositiveNumber(
  name: string,
  value: string,
  integer = false
): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value.trim())
  const valid = integer ? Number.isInteger(parsed) : Number.isFinite(parsed)
  if (!valid || parsed <= 0) {
    throw new Error(
      `Input "${name}" must be a positive ${integer ? 'integer' : 'number'} (got "${value}").`
    )
  }
  return parsed
}

async function run(): Promise<void> {
  try {
    const issuerId: string = getInput('issuer-id')
    const apiKeyId: string = getInput('api-key-id')
    const apiPrivateKey: string = getInput('api-private-key')
    const appPath: string = getInput('app-path')
    const appType: string = getInput('app-type')
    const releaseNotes: string = getInput('release-notes')
    const usesNonExemptEncryptionInput: string = getInput(
      'uses-non-exempt-encryption'
    )
    const waitForProcessingInput: string = getInput('wait-for-processing')
    const waitForProcessing =
      waitForProcessingInput.trim() === ''
        ? true
        : waitForProcessingInput.trim().toLowerCase() !== 'false'
    const backendInput: string = getInput('backend') || 'appstore-api'
    const transporterExecutablePath: string | undefined =
      getInput('transporter-executable-path') || undefined
    const uploadAttempts = parsePositiveNumber(
      'upload-attempts',
      getInput('upload-attempts'),
      true
    )
    const uploadTimeoutMinutes = parsePositiveNumber(
      'upload-timeout-minutes',
      getInput('upload-timeout-minutes')
    )

    const backend = normalizeBackend(backendInput)
    info(
      `Using upload backend: ${backend} for appPath=${appPath}, appType=${appType}`
    )

    const factories: UploadFactory = {
      appstoreApi,
      transporter,
      altool
    }

    const uploader = factories[backend]
    if (!uploader) {
      throw new Error(`Unsupported backend ${backend}`)
    }

    if (backend !== 'appstoreApi' && platform() !== 'darwin') {
      throw new Error(
        `Backend "${backend}" requires a macOS runner (found ${platform()}).`
      )
    }

    if (backend === 'appstoreApi' && appType.toLowerCase() === 'macos') {
      throw new Error(
        'The "appstore-api" backend only supports .ipa uploads. For macOS (.pkg) builds, set backend to "altool" or "transporter".'
      )
    }

    const metadataPlan = await prepareBuildMetadata({
      releaseNotes,
      usesNonExemptEncryptionInput,
      waitForProcessing,
      appPath
    })

    const execOptions: ExecOptions = {}

    info('Installing API private key.')
    await installPrivateKey(apiKeyId, apiPrivateKey)
    info('Private key installed.')
    const result = await uploader.upload(
      {
        appPath,
        appType,
        apiKeyId,
        issuerId,
        apiPrivateKey,
        waitForProcessing,
        transporterExecutablePath,
        uploadAttempts,
        uploadTimeoutMinutes
      },
      execOptions
    )
    info(`Upload finished via backend: ${result.backend}`)
    setOutput('upload-backend', result.backend)

    const metadataOutcome = await submitBuildMetadataUpdates(metadataPlan, {
      appType,
      issuerId,
      apiKeyId,
      apiPrivateKey
    })
    info(metadataOutcome.summary)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  } finally {
    await deleteAllPrivateKeys()
    info('Private keys cleaned up.')
  }
}

run()
