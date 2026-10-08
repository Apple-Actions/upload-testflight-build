import {info, warning} from '@actions/core'
import {generateJwt} from './auth/jwt'
import {extractAppMetadata, type AppMetadata} from './utils/appMetadata'
import {buildPlatform, fetchJson, type TokenSource} from './utils/http'
import {lookupAppId} from './utils/lookup-app-id'
import {lookupBuildIdWithRetry} from './utils/buildLookup'

const NOTES_ATTACH_PREFIX =
  'The build already uploaded, but attaching TestFlight "What to Test" failed'

type BetaAppLocalization = {
  id?: string
  attributes?: {locale?: string}
}

type BetaBuildLocalization = {
  id?: string
}

export type MetadataOutcome = {
  status: 'skipped' | 'notes-created' | 'notes-updated' | 'encryption-only'
  summary: string
}

export type MetadataPlan =
  | {skip: MetadataOutcome}
  | {
      releaseNotes: string
      usesNonExemptEncryption?: boolean
      app: AppMetadata
    }

export async function prepareBuildMetadata(params: {
  releaseNotes: string
  usesNonExemptEncryptionInput?: string
  appPath: string
  waitForProcessing?: boolean
}): Promise<MetadataPlan> {
  const trimmed = params.releaseNotes.trim()
  const parsedEncryption = parseUsesNonExemptEncryption(
    params.usesNonExemptEncryptionInput
  )

  if (trimmed === '' && parsedEncryption === undefined) {
    info(
      'No release note or encryption compliance requested. Skipping TestFlight metadata update.'
    )
    return {
      skip: {
        status: 'skipped',
        summary:
          'TestFlight metadata skipped: no release notes or encryption compliance requested.'
      }
    }
  }

  if (params.waitForProcessing === false) {
    info(
      'wait-for-processing=false; skipping release notes and encryption updates because build visibility is not guaranteed.'
    )
    return {
      skip: {
        status: 'skipped',
        summary:
          'TestFlight metadata skipped: wait-for-processing=false, so release notes and encryption compliance were not applied.'
      }
    }
  }

  return {
    releaseNotes: trimmed,
    usesNonExemptEncryption: parsedEncryption,
    app: await extractAppMetadata(params.appPath)
  }
}

export async function submitBuildMetadataUpdates(
  plan: MetadataPlan,
  params: {
    appType: string
    issuerId: string
    apiKeyId: string
    apiPrivateKey: string
  }
): Promise<MetadataOutcome> {
  if ('skip' in plan) {
    return plan.skip
  }

  const trimmed = plan.releaseNotes
  const wantsReleaseNotes = trimmed !== ''
  const parsedEncryption = plan.usesNonExemptEncryption
  const wantsEncryptionUpdate = parsedEncryption !== undefined
  const metadata = plan.app
  const token = () =>
    generateJwt(params.issuerId, params.apiKeyId, params.apiPrivateKey)
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
  let notesResult: 'created' | 'updated' | undefined
  if (wantsReleaseNotes) {
    const locale = await requireTestInformationLocale(
      appId,
      metadata.bundleId,
      token
    )
    notesResult = await attachReleaseNotes(buildId, locale, trimmed, token)
  }
  if (wantsEncryptionUpdate) {
    await updateEncryptionCompliance(
      buildId,
      parsedEncryption as boolean,
      token
    )
  }

  const encryptionSuffix = wantsEncryptionUpdate
    ? ` Set usesNonExemptEncryption=${parsedEncryption}.`
    : ''
  if (notesResult === 'created') {
    return {
      status: 'notes-created',
      summary: `Created TestFlight release note for build ${buildId}.${encryptionSuffix}`
    }
  }
  if (notesResult === 'updated') {
    return {
      status: 'notes-updated',
      summary: `Updated existing TestFlight release note for build ${buildId}.${encryptionSuffix}`
    }
  }
  return {
    status: 'encryption-only',
    summary: `No release notes requested.${encryptionSuffix}`
  }
}

async function requireTestInformationLocale(
  appId: string,
  bundleId: string,
  token: TokenSource
): Promise<string> {
  const response = await fetchJson<{data?: BetaAppLocalization[]}>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/list-beta-app-localizations-for-an-app
    `/apps/${appId}/betaAppLocalizations`,
    token,
    `${NOTES_ATTACH_PREFIX}: Failed to query Test Information.`
  )

  const localizations = response.data ?? []
  if (localizations.length === 0) {
    throw new Error(
      `${NOTES_ATTACH_PREFIX}: Test Information is missing for app ${appId} (bundle id ${bundleId}). Fill App Store Connect → TestFlight → Test Information for the app (Beta App Description, Feedback Email, primary locale), or run scripts/populate-test-information.sh --apply with --issuer-id, --api-key-id, and --api-private-key-path.`
    )
  }

  const locale = localizations[0]?.attributes?.locale?.trim()
  if (!locale) {
    throw new Error(
      `${NOTES_ATTACH_PREFIX}: Test Information for app ${appId} (bundle id ${bundleId}) has no locale.`
    )
  }

  return locale
}

async function attachReleaseNotes(
  buildId: string,
  locale: string,
  releaseNotes: string,
  token: TokenSource
): Promise<'created' | 'updated'> {
  const whatsNew = releaseNotes.slice(0, 4000)
  const existingId = await fetchBuildLocalizationId(buildId, token)
  if (existingId) {
    await updateReleaseNotes(existingId, whatsNew, token)
    return 'updated'
  }

  try {
    await createReleaseNotes(buildId, locale, whatsNew, token)
    return 'created'
  } catch (error: unknown) {
    if (!isConflictError(error)) {
      throw error
    }

    const racedId = await fetchBuildLocalizationId(buildId, token)
    if (!racedId) {
      throw new Error(
        `${NOTES_ATTACH_PREFIX}: a beta build localization never appeared for build ${buildId}. ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }

    await updateReleaseNotes(racedId, whatsNew, token)
    return 'updated'
  }
}

async function fetchBuildLocalizationId(
  buildId: string,
  token: TokenSource
): Promise<string | undefined> {
  const response = await fetchJson<{data?: BetaBuildLocalization[]}>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/betabuildlocalizations
    `/builds/${buildId}/betaBuildLocalizations`,
    token,
    `${NOTES_ATTACH_PREFIX}: Failed to query beta build localizations.`
  )

  const localizationId = response.data?.[0]?.id
  return localizationId || undefined
}

async function createReleaseNotes(
  buildId: string,
  locale: string,
  whatsNew: string,
  token: TokenSource
): Promise<void> {
  const payload = {
    data: {
      type: 'betaBuildLocalizations',
      attributes: {
        locale,
        whatsNew
      },
      relationships: {
        build: {
          data: {
            type: 'builds',
            id: buildId
          }
        }
      }
    }
  }

  await fetchJson(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/post-v1-betabuildlocalizations
    '/betaBuildLocalizations',
    token,
    `${NOTES_ATTACH_PREFIX}: Failed to create TestFlight release note.`,
    'POST',
    payload
  )
  info('Successfully created TestFlight release note.')
}

async function updateReleaseNotes(
  localizationId: string,
  whatsNew: string,
  token: TokenSource
): Promise<void> {
  const payload = {
    data: {
      id: localizationId,
      type: 'betaBuildLocalizations',
      attributes: {
        whatsNew
      }
    }
  }

  await fetchJson(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/betabuildlocalizations
    `/betaBuildLocalizations/${localizationId}`,
    token,
    `${NOTES_ATTACH_PREFIX}: Failed to update TestFlight release note.`,
    'PATCH',
    payload
  )
  info('Successfully updated TestFlight release note.')
}

async function updateEncryptionCompliance(
  buildId: string,
  usesNonExemptEncryption: boolean,
  token: TokenSource
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

function isConflictError(error: unknown): boolean {
  return error instanceof Error && /\(409\)/.test(error.message)
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
