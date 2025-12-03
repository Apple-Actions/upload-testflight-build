import {fetchJson} from './http'

export async function lookupAppId(
  bundleId: string,
  token: string
): Promise<string> {
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
