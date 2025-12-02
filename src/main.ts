import {getInput, setOutput, setFailed, info} from '@actions/core'
import {platform} from 'os'
import {submitReleaseNotesIfProvided} from './releaseNotes'
import {installPrivateKey, deleteAllPrivateKeys} from './keys'
import {UploadFactory} from './backends/types'
import {transporterBackend} from './backends/transporterBackend'
import {altoolBackend} from './backends/altoolBackend'
import {appStoreApiBackend} from './backends/appstore-api-backend'
import {normalizeBackend} from './backends/normalize'

import {ExecOptions} from '@actions/exec/lib/interfaces'

async function run(): Promise<void> {
  try {
    if (platform() !== 'darwin') {
      throw new Error('Action requires macOS agent.')
    }

    const issuerId: string = getInput('issuer-id')
    const apiKeyId: string = getInput('api-key-id')
    const apiPrivateKey: string = getInput('api-private-key')
    const appPath: string = getInput('app-path')
    const appType: string = getInput('app-type')
    const releaseNotes: string = getInput('release-notes')
    const backendInput: string = getInput('backend') || 'appstore-api'

    const backend = normalizeBackend(backendInput)
    info(
      `Using upload backend: ${backend} for appPath=${appPath}, appType=${appType}`
    )

    const factories: UploadFactory = {
      'appstore-api': appStoreApiBackend,
      transporter: transporterBackend,
      altool: altoolBackend
    }

    const uploader = factories[backend]
    if (!uploader) {
      throw new Error(`Unsupported backend ${backend}`)
    }

    let output = ''
    const execOptions: ExecOptions = {
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      }
    }

    info('Installing API private key.')
    await installPrivateKey(apiKeyId, apiPrivateKey)
    info('Private key installed.')
    const result = await uploader.upload(
      {
        appPath,
        appType,
        apiKeyId,
        issuerId,
        apiPrivateKey
      },
      execOptions
    )
    info(`Upload finished via backend: ${result.backend}`)
    await submitReleaseNotesIfProvided({
      releaseNotes,
      appPath,
      appType,
      issuerId,
      apiKeyId,
      apiPrivateKey
    })
    info('Release notes step completed (or skipped).')
    await deleteAllPrivateKeys()
    info('Private keys cleaned up.')

    const responseText = result.log ?? output ?? ''
    setOutput('transporter-response', responseText)
    setOutput('upload-backend', result.backend)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  }
}

run()
