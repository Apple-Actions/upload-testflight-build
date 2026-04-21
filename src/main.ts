import {getInput, setOutput, setFailed, info} from '@actions/core'
import {platform} from 'os'
import {submitBuildMetadataUpdates} from './buildMetadata'
import {installPrivateKey, deleteAllPrivateKeys} from './utils/keys'
import {UploadFactory} from './backends/types'
import {transporter} from './backends/transporter'
import {altool} from './backends/altool'
import {appstoreApi} from './backends/appstore-api'
import {normalizeBackend} from './utils/normalize-backend'

import {ExecOptions} from '@actions/exec/lib/interfaces'

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
        transporterExecutablePath
      },
      execOptions
    )
    info(`Upload finished via backend: ${result.backend}`)
    await submitBuildMetadataUpdates({
      releaseNotes,
      usesNonExemptEncryptionInput,
      waitForProcessing,
      appPath,
      appType,
      issuerId,
      apiKeyId,
      apiPrivateKey
    })
    info('Release notes step completed (or skipped).')
    await deleteAllPrivateKeys()
    info('Private keys cleaned up.')

    setOutput('upload-backend', result.backend)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  }
}

run()
