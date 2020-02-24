import * as core from '@actions/core'
import * as os from 'os'
import {v1} from 'appstoreconnect'
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
    const waitForProcessing: string = core.getInput('wait-for-build-processing')

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

    if (waitForProcessing === 'true') {
      // TODO: poll app-store connect for build
      const token = v1.token(apiPrivateKey, issuerId, apiKeyId)
      const api = v1(token)

      const builds = await v1.testflight.listBuilds(api, {
        sort: ['-uploadedDate']
      })
      for (const build of builds.data) {
        core.debug(JSON.stringify(build))
      }
    }

    core.setOutput('altool-response', output)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
