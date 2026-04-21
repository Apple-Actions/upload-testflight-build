import {fetchJson} from './http'
import {pollUntil, pollWithBackoff} from './poll'

type BuildLookupParams = {
  appId: string
  buildNumber: string
  platform: string
  token: string
}

const DEFAULT_ATTEMPTS = 20
const DEFAULT_DELAY_MS = 30000

export async function lookupBuildIdWithRetry(
  params: BuildLookupParams,
  attempts: number = DEFAULT_ATTEMPTS,
  delayMs: number = DEFAULT_DELAY_MS,
  onRetry?: (attempt: number) => void
): Promise<string> {
  const query = buildFilterQuery(params)

  const result = await pollUntil(
    async () => {
      const response = await fetchJson<{
        data?: Array<{id?: string}>
      }>(
        // Docs: https://developer.apple.com/documentation/appstoreconnectapi/builds
        `/builds?${query}`,
        params.token,
        'Failed to query builds.'
      )
      return response.data?.[0]?.id
    },
    Boolean,
    {attempts, delayMs, onRetry}
  )

  return result
}

export async function lookupBuildState(
  params: BuildLookupParams
): Promise<string | undefined> {
  const query = buildFilterQuery(params)

  const response = await fetchJson<{
    data?: Array<{attributes?: {processingState?: string}}>
  }>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/builds
    `/builds?${query}`,
    params.token,
    'Failed to query builds for processing state.'
  )

  return response.data?.[0]?.attributes?.processingState
}

export async function waitForBuildProcessing(
  params: BuildLookupParams,
  options: {
    visibilityAttempts: number
    visibilityDelayMs: number
    processingAttempts: number
    processingDelayMs: number
    onRetry?: (message: string) => void
  }
): Promise<void> {
  const {
    visibilityAttempts,
    visibilityDelayMs,
    processingAttempts,
    processingDelayMs,
    onRetry
  } = options

  await sleepMs(visibilityDelayMs) // initial wait before first lookup

  await pollWithBackoff(
    () => lookupBuildState(params),
    state => state === 'VALID' || state === 'PROCESSING',
    visibilityAttempts,
    visibilityDelayMs,
    label =>
      onRetry?.(`Waiting for build ${params.buildNumber} visibility: ${label}`)
  )

  await pollWithBackoff(
    () => lookupBuildState(params),
    state => state === 'VALID',
    processingAttempts,
    processingDelayMs,
    label =>
      onRetry?.(`Waiting for build ${params.buildNumber} processing: ${label}`)
  )
}

function buildFilterQuery(params: BuildLookupParams): string {
  const query = new URLSearchParams()
  query.set('filter[app]', params.appId)
  query.set('filter[version]', params.buildNumber)
  query.set('filter[preReleaseVersion.platform]', params.platform)
  return query.toString()
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
