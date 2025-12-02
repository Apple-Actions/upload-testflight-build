import {info, warning} from '@actions/core'
import {generateJwt} from './auth/jwt'
import {extractAppMetadata} from './appMetadata'
import {buildPlatform, fetchJson} from './http'
import {pollUntil} from './poll'

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
  const token = generateJwt(
    params.issuerId,
    params.apiKeyId,
    params.apiPrivateKey
  )
  const platform = buildPlatform(params.appType)

  const appId = await lookupAppId(metadata.bundleId, token)
  const buildId = await lookupBuildId(
    appId,
    metadata.buildNumber,
    platform,
    token
  )
  const localizationId = await lookupLocalizationId(buildId, token)
  await updateReleaseNotes(localizationId, trimmed, token)
}

async function lookupAppId(bundleId: string, token: string): Promise<string> {
  const params = new URLSearchParams()
  params.set('filter[bundleId]', bundleId)

  const response = await fetchJson<{
    data?: Array<{id?: string}>
  }>(
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

  const result = await pollUntil(
    async () => {
      const response = await fetchJson<{
        data?: Array<{id?: string}>
      }>(
        `/builds?${params.toString()}`,
        token,
        'Failed to query builds for release note update.'
      )

      return response.data?.[0]?.id
    },
    Boolean,
    {
      attempts: MAX_ATTEMPTS,
      delayMs: RETRY_DELAY_MS,
      onRetry: attempt => {
        warning(
          `Build ${buildNumber} not yet visible in App Store Connect (attempt ${
            attempt + 1
          }/${MAX_ATTEMPTS}). Retrying in ${Math.round(RETRY_DELAY_MS / 1000)}s`
        )
      }
    }
  )

  return result
}

async function lookupLocalizationId(
  buildId: string,
  token: string
): Promise<string> {
  const result = await pollUntil(
    async () => {
      const response = await fetchJson<{
        data?: Array<{id?: string}>
      }>(
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
    `/betaBuildLocalizations/${localizationId}`,
    token,
    'Failed to update TestFlight release note.',
    'PATCH',
    payload
  )
  info('Successfully updated TestFlight release note.')
}
