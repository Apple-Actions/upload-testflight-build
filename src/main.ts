import * as core from '@actions/core'
import * as os from 'os'
import * as altool from './altool'

import {ExecOptions} from '@actions/exec/lib/interfaces'

async function run(): Promise<void> {
  try {
    if (os.platform() !== 'darwin') {
      throw new Error('Action requires macOS agent.')
    }

    const issuerId: string = core.getInput('issuer-id')
    const apiKeyId: string = core.getInput('api-key-id')
    const apiPrivateKey: string = core.getInput('api-private-key')
    const appPath: string = core.getInput('app-path')
    const appType: string = core.getInput('app-type')

    let output = ''
    const options: ExecOptions = {}
    options.listeners = {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }

    await altool.installPrivateKey(apiKeyId, apiPrivateKey)
    await altool.uploadApp(appPath, appType, apiKeyId, issuerId, options)
    await altool.deleteAllPrivateKeys()

    core.setOutput('altool-response', output)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
