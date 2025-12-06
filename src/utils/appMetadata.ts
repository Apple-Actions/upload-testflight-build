import {mkdtemp, readdir} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {exec} from '@actions/exec'
import {rmRF} from '@actions/io'

type AppMetadata = {
  bundleId: string
  buildNumber: string
  shortVersion: string
}

export async function extractAppMetadata(
  appPath: string
): Promise<AppMetadata> {
  const workingDir = await mkdtemp(join(tmpdir(), 'upload-testflight-'))

  try {
    await exec('ditto', ['-xk', appPath, workingDir], {silent: true})

    const payloadDirectory = join(workingDir, 'Payload')
    const entries = await readdir(payloadDirectory)
    const appDirectory = entries.find(entry => entry.endsWith('.app'))

    if (!appDirectory) {
      throw new Error(
        'Unable to locate *.app bundle inside TestFlight payload.'
      )
    }

    const infoPath = join(payloadDirectory, appDirectory, 'Info.plist')
    const infoJson = await readPlistAsJson(infoPath)
    const parsed = JSON.parse(infoJson) as Record<string, string>

    const bundleId = parsed['CFBundleIdentifier']
    const buildNumber = parsed['CFBundleVersion']
    const shortVersion = parsed['CFBundleShortVersionString']

    if (!bundleId || !buildNumber || !shortVersion) {
      throw new Error(
        'Info.plist missing CFBundleIdentifier, CFBundleVersion, or CFBundleShortVersionString.'
      )
    }

    return {bundleId, buildNumber, shortVersion}
  } finally {
    await rmRF(workingDir)
  }
}

async function readPlistAsJson(plistPath: string): Promise<string> {
  let output = ''
  await exec('plutil', ['-convert', 'json', '-o', '-', plistPath], {
    silent: true,
    listeners: {
      stdout: (data: Buffer) => {
        output += data.toString()
      }
    }
  })

  return output
}
