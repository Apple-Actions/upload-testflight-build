import AdmZip from 'adm-zip'
import plist from 'plist'
import bplist from 'bplist-parser'

type AppMetadata = {
  bundleId: string
  buildNumber: string
  shortVersion: string
}

export async function extractAppMetadata(
  appPath: string
): Promise<AppMetadata> {
  const zip = new AdmZip(appPath)
  const entries = zip.getEntries()
  const infoEntry = entries.find((entry: {entryName: string}) =>
    /Payload\/[^/]+\.app\/Info\.plist$/.test(entry.entryName)
  )

  if (!infoEntry) {
    throw new Error('Unable to locate Info.plist inside the IPA Payload.')
  }

  const plistBuffer = infoEntry.getData()
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

function parsePlistBuffer(buffer: Buffer): Record<string, string> {
  const isBinary =
    buffer.length >= 6 && buffer.subarray(0, 6).toString('utf8') === 'bplist'

  if (isBinary) {
    const parsed = bplist.parseBuffer(buffer)
    return (parsed[0] ?? {}) as Record<string, string>
  }

  return plist.parse(buffer.toString()) as Record<string, string>
}
