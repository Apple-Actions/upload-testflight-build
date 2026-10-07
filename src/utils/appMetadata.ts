import {open, mkdtemp, readFile, readdir, rm} from 'fs/promises'
import {tmpdir} from 'os'
import {extname, join} from 'path'
import {exec} from '@actions/exec'
import AdmZip from 'adm-zip'
import {parse as parsePlist} from 'plist'
import {parseBuffer} from 'bplist-parser'

type AppMetadata = {
  bundleId: string
  buildNumber: string
  shortVersion: string
}

const MAC_APP_INFO_PLIST = /\.app\/Contents\/Info\.plist$/

export async function extractAppMetadata(
  appPath: string
): Promise<AppMetadata> {
  const plistBuffer = (await isPkg(appPath))
    ? await readPkgInfoPlist(appPath)
    : readIpaInfoPlist(appPath)
  const parsed = parsePlistBuffer(plistBuffer)

  const bundleId = parsed['CFBundleIdentifier']
  const buildNumber = parsed['CFBundleVersion']
  const shortVersion = parsed['CFBundleShortVersionString']

  if (!bundleId || !buildNumber || !shortVersion) {
    throw new Error(
      'Info.plist missing CFBundleIdentifier, CFBundleVersion, or CFBundleShortVersionString.'
    )
  }

  return {bundleId, buildNumber, shortVersion}
}

function readIpaInfoPlist(ipaPath: string): Buffer {
  const zip = new AdmZip(ipaPath)
  const entries = zip.getEntries()
  const infoEntry = entries.find((entry: {entryName: string}) =>
    /Payload\/[^/]+\.app\/Info\.plist$/.test(entry.entryName)
  )

  if (!infoEntry) {
    throw new Error('Unable to locate Info.plist inside the IPA Payload.')
  }

  return infoEntry.getData()
}

async function isPkg(appPath: string): Promise<boolean> {
  if (extname(appPath).toLowerCase() === '.pkg') return true

  try {
    const file = await open(appPath, 'r')
    try {
      const header = Buffer.alloc(4)
      const {bytesRead} = await file.read(header, 0, 4, 0)
      return bytesRead === 4 && header.toString('latin1') === 'xar!'
    } finally {
      await file.close()
    }
  } catch {
    return false
  }
}

async function readPkgInfoPlist(pkgPath: string): Promise<Buffer> {
  const tmp = await mkdtemp(join(tmpdir(), 'pkg-meta-'))
  try {
    const expanded = join(tmp, 'expanded')
    await exec('pkgutil', ['--expand-full', pkgPath, expanded], {silent: true})

    const entries = await readdir(expanded, {recursive: true})
    const plistPath = entries
      .filter(entry => MAC_APP_INFO_PLIST.test(entry))
      .sort((a, b) => appDepth(a) - appDepth(b))[0]

    if (!plistPath) {
      throw new Error(
        'Unable to locate <App>.app/Contents/Info.plist inside the .pkg.'
      )
    }

    return await readFile(join(expanded, plistPath))
  } finally {
    await rm(tmp, {recursive: true, force: true})
  }
}

function appDepth(path: string): number {
  return path.split('.app/').length - 1
}

function parsePlistBuffer(buffer: Buffer): Record<string, string> {
  const isBinary =
    buffer.length >= 6 && buffer.subarray(0, 6).toString('utf8') === 'bplist'

  if (isBinary) {
    const parsed = parseBuffer(buffer)
    return (parsed[0] ?? {}) as Record<string, string>
  }

  return parsePlist(buffer.toString()) as Record<string, string>
}
