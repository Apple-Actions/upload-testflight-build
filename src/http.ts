import {info} from '@actions/core'

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
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extraHeaders
  }

  const safeHeaders = {
    ...headers,
    Authorization: headers.Authorization ? '[REDACTED]' : undefined
  }

  const stringifiedBody = body ? JSON.stringify(body) : undefined
  info(
    `HTTP request: ${method} ${url.toString()} headers=${JSON.stringify(
      safeHeaders
    )} body=${stringifiedBody ?? '<none>'}`
  )

  const response = await fetch(url, {
    method,
    headers,
    body: stringifiedBody
  })

  const responseText = await response.text()
  info(
    `HTTP response: ${method} ${url.toString()} status=${response.status} ${response.statusText} body=${responseText}`
  )

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status}): ${responseText}`)
  }

  if (response.status === 204) {
    return {} as T
  }

  const contentType = response.headers.get('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return {} as T
  }

  return JSON.parse(responseText) as T
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
