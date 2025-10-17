import {createSign} from 'crypto'
import {mkdtemp, readdir} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {exec} from '@actions/exec'
import {rmRF} from '@actions/io'
import {info, warning} from '@actions/core'

type AppMetadata = {
  bundleId: string
  buildNumber: string
}

const PLATFORM_MAP: Record<string, string> = {
  ios: 'IOS',
  macos: 'MAC_OS',
  appletvos: 'TV_OS',
  visionos: 'VISION_OS'
}

const BASE_URL = 'https://api.appstoreconnect.apple.com/v1'
const MAX_ATTEMPTS = 20
const RETRY_DELAY_MS = 30000

export async function submitReleaseNotesIfProvided(params: {
  releaseNotes: string
  appPath: string
  appType: string
  issuerId: string
  apiKeyId: string
  apiPrivateKey: string
}): Promise<void> {
  const trimmed = params.releaseNotes.trim()
  if (trimmed === '') {
    info('No release note provided. Skipping TestFlight metadata update.')
    return
  }

  const metadata = await extractAppMetadata(params.appPath)
  const token = generateToken(
    params.issuerId,
    params.apiKeyId,
    params.apiPrivateKey
  )
  const platform = PLATFORM_MAP[params.appType.toLowerCase()] ?? 'IOS'

  const appId = await lookupAppId(metadata.bundleId, token)
  const buildId = await lookupBuildId(
    appId,
    metadata.buildNumber,
    platform,
    token
  )
  const localizationId = await lookupLocalizationId(buildId, token)
  await updatereleaseNotes(localizationId, trimmed, token)
}

function generateToken(
  issuerId: string,
  apiKeyId: string,
  apiPrivateKey: string
): string {
  const header = {
    alg: 'ES256',
    kid: apiKeyId,
    typ: 'JWT'
  }

  const now = Math.floor(Date.now() / 1000)

  const payload = {
    iss: issuerId,
    aud: 'appstoreconnect-v1',
    iat: now - 60,
    exp: now + 600
  }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url'
  )
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  )
  const signingInput = `${encodedHeader}.${encodedPayload}`

  const signer = createSign('SHA256')
  signer.update(signingInput)
  signer.end()
  const signature = signer.sign({
    key: apiPrivateKey,
    dsaEncoding: 'ieee-p1363'
  })

  const encodedSignature = Buffer.from(signature).toString('base64url')
  return `${signingInput}.${encodedSignature}`
}

async function extractAppMetadata(appPath: string): Promise<AppMetadata> {
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

    if (!bundleId || !buildNumber) {
      throw new Error(
        'Info.plist missing CFBundleIdentifier or CFBundleVersion.'
      )
    }

    return {bundleId, buildNumber}
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

async function lookupAppId(bundleId: string, token: string): Promise<string> {
  const params = new URLSearchParams()
  params.set('filter[bundleId]', bundleId)

  const response = await fetchJson(
    `/apps?${params.toString()}`,
    token,
    'Failed to locate App Store Connect application.'
  )

  const appId = response.data?.[0]?.id
  if (!appId) {
    throw new Error(
      `Unable to find App Store Connect app for bundle id ${bundleId}.`
    )
  }

  return appId
}

async function lookupBuildId(
  appId: string,
  buildNumber: string,
  platform: string,
  token: string
): Promise<string> {
  const params = new URLSearchParams()
  params.set('filter[app]', appId)
  params.set('filter[version]', buildNumber)
  params.set('filter[preReleaseVersion.platform]', platform)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetchJson(
      `/builds?${params.toString()}`,
      token,
      'Failed to query builds for release note update.'
    )

    const buildId = response.data?.[0]?.id
    if (buildId) {
      return buildId
    }

    warning(
      `Build ${buildNumber} not yet visible in App Store Connect (attempt ${
        attempt + 1
      }/${MAX_ATTEMPTS}). Retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`
    )
    await delay(RETRY_DELAY_MS)
  }

  throw new Error(
    `Timed out waiting for build ${buildNumber} to appear in App Store Connect.`
  )
}

async function lookupLocalizationId(
  buildId: string,
  token: string
): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetchJson(
      `/builds/${buildId}/betaBuildLocalizations`,
      token,
      'Failed to query beta build localizations.'
    )

    const localizationId = response.data?.[0]?.id
    if (localizationId) {
      return localizationId
    }

    warning(
      `Localization not ready for build ${buildId} (attempt ${attempt + 1}/${MAX_ATTEMPTS}). Retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`
    )
    await delay(RETRY_DELAY_MS)
  }

  throw new Error(
    `Timed out locating beta build localization for build ${buildId}.`
  )
}

async function updatereleaseNotes(
  localizationId: string,
  releaseNotes: string,
  token: string
): Promise<void> {
  const payload = {
    data: {
      id: localizationId,
      type: 'betaBuildLocalizations',
      attributes: {
        whatsNew: releaseNotes.slice(0, 4000)
      }
    }
  }

  await fetchJson(
    `/betaBuildLocalizations/${localizationId}`,
    token,
    'Failed to update TestFlight release note.',
    'PATCH',
    payload
  )
  info('Successfully updated TestFlight release note.')
}

async function fetchJson(
  path: string,
  token: string,
  errorMessage: string,
  method: 'GET' | 'PATCH' = 'GET',
  body?: unknown
): Promise<unknown> {
  const url = new URL(path, BASE_URL)
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: method === 'PATCH' ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${errorMessage} (${response.status}): ${text}`)
  }

  if (response.status === 204) {
    return {}
  }

  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return {}
  }

  return response.json()
}

async function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs)
  })
}
