const BASE_URL = 'https://api.appstoreconnect.apple.com/v1'

export async function fetchJson<T = unknown>(
  path: string,
  token: string,
  errorMessage: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const url = new URL(path, BASE_URL)
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${errorMessage} (${response.status}): ${text}`)
  }

  if (response.status === 204) {
    return {} as T
  }

  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return {} as T
  }

  return (await response.json()) as T
}

export function buildPlatform(appType: string): string {
  switch (appType.toLowerCase()) {
    case 'macos':
      return 'MAC_OS'
    case 'appletvos':
      return 'TV_OS'
    case 'visionos':
      return 'VISION_OS'
    default:
      return 'IOS'
  }
}
