import {getInput, setOutput, setFailed} from '@actions/core'
import {platform} from 'os'
import {installPrivateKey, uploadApp, deleteAllPrivateKeys} from './altool'

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
    const appleId: string = getInput('apple-id')

    let output = ''
    const options: ExecOptions = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }

    await installPrivateKey(apiKeyId, apiPrivateKey)
    await uploadApp(appPath, appType, apiKeyId, issuerId, appleId, options)
    await deleteAllPrivateKeys()

    setOutput('altool-response', output)
  } catch (error: unknown | Error) {
    setFailed((error as Error).message || 'An unknown error occurred.')
  }
}

run()
