import {info, warning} from '@actions/core'
import {generateJwt} from './auth/jwt'
import {extractAppMetadata} from './utils/appMetadata'
import {buildPlatform, fetchJson} from './utils/http'
import {lookupAppId} from './utils/lookup-app-id'
import {lookupBuildIdWithRetry} from './utils/buildLookup'
import {pollUntil} from './utils/poll'

export async function submitBuildMetadataUpdates(params: {
  releaseNotes: string
  usesNonExemptEncryptionInput?: string
  appPath: string
  appType: string
  issuerId: string
  apiKeyId: string
  apiPrivateKey: string
  waitForProcessing?: boolean
}): Promise<void> {
  const trimmed = params.releaseNotes.trim()
  const wantsReleaseNotes = trimmed !== ''
  const parsedEncryption = parseUsesNonExemptEncryption(
    params.usesNonExemptEncryptionInput
  )
  const wantsEncryptionUpdate = parsedEncryption !== undefined

  if (!wantsReleaseNotes && !wantsEncryptionUpdate) {
    info(
      'No release note or encryption compliance requested. Skipping TestFlight metadata update.'
    )
    return
  }

  if (params.waitForProcessing === false) {
    info(
      'wait-for-processing=false; skipping release notes and encryption updates because build visibility is not guaranteed.'
    )
    return
  }

  const metadata = await extractAppMetadata(params.appPath)
  const token = generateJwt(
    params.issuerId,
    params.apiKeyId,
    params.apiPrivateKey
  )
  const platform = buildPlatform(params.appType)

  const appId = await lookupAppId(metadata.bundleId, token)
  const buildId = await lookupBuildIdWithRetry(
    {
      appId,
      buildNumber: metadata.buildNumber,
      platform,
      token
    },
    20,
    30000,
    attempt => {
      warning(
        `Build ${metadata.buildNumber} not yet visible in App Store Connect (attempt ${
          attempt + 1
        }/20). Retrying in ${Math.round(30000 / 1000)}s`
      )
    }
  )
  if (wantsReleaseNotes) {
    const localizationId = await lookupLocalizationId(buildId, token)
    await updateReleaseNotes(localizationId, trimmed, token)
  }
  if (wantsEncryptionUpdate) {
    await updateEncryptionCompliance(
      buildId,
      parsedEncryption as boolean,
      token
    )
  }
}

async function lookupLocalizationId(
  buildId: string,
  token: string
): Promise<string> {
  const MAX_ATTEMPTS = 20
  const RETRY_DELAY_MS = 30000

  const result = await pollUntil(
    async () => {
      const response = await fetchJson<{
        data?: Array<{id?: string}>
      }>(
        // Docs: https://developer.apple.com/documentation/appstoreconnectapi/betabuildlocalizations
        `/builds/${buildId}/betaBuildLocalizations`,
        token,
        'Failed to query beta build localizations.'
      )

      return response.data?.[0]?.id
    },
    Boolean,
    {
      attempts: MAX_ATTEMPTS,
      delayMs: RETRY_DELAY_MS,
      onRetry: attempt => {
        warning(
          `Localization not ready for build ${buildId} (attempt ${attempt + 1}/${MAX_ATTEMPTS}). Retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`
        )
      }
    }
  )

  return result
}

async function updateReleaseNotes(
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
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/betabuildlocalizations
    `/betaBuildLocalizations/${localizationId}`,
    token,
    'Failed to update TestFlight release note.',
    'PATCH',
    payload
  )
  info('Successfully updated TestFlight release note.')
}

async function updateEncryptionCompliance(
  buildId: string,
  usesNonExemptEncryption: boolean,
  token: string
): Promise<void> {
  await fetchJson(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/builds
    `/builds/${buildId}`,
    token,
    'Failed to update encryption compliance for build.',
    'PATCH',
    {
      data: {
        id: buildId,
        type: 'builds',
        attributes: {
          usesNonExemptEncryption
        }
      }
    }
  )
  info(
    `Set usesNonExemptEncryption=${usesNonExemptEncryption} for build ${buildId}.`
  )
}

function parseUsesNonExemptEncryption(value?: string): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(
    `Invalid uses-non-exempt-encryption value "${value}". Use "true" or "false".`
  )
}
