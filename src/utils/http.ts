import {debug} from '@actions/core'

const BASE_URL = 'https://api.appstoreconnect.apple.com/v1'
const RETRY_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const DEFAULT_RETRY: RetryOptions = {retries: 5, baseDelayMs: 1000, factor: 2}

type RetryOptions = {
  retries: number
  baseDelayMs: number
  factor: number
}

export async function fetchJson<T = unknown>(
  path: string,
  token: string,
  errorMessage: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>,
  retryOptions: RetryOptions = DEFAULT_RETRY
): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path
  const url = new URL(normalizedPath, `${BASE_URL}/`)
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept-Language': 'en',
    ...extraHeaders
  }

  const safeHeaders = {
    ...headers,
    Authorization: headers.Authorization ? '[REDACTED]' : undefined
  }

  const stringifiedBody = body ? JSON.stringify(body) : undefined
  debug(
    `HTTP request: ${method} ${url.toString()} headers=${JSON.stringify(
      safeHeaders
    )} body=${stringifiedBody ?? '<none>'}`
  )

  const response = await performWithRetry(
    () =>
      fetch(url, {
        method,
        headers,
        body: stringifiedBody
      }),
    retryOptions,
    `${method} ${url.toString()}`
  )

  const responseText = await response.text()
  debug(
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

async function performWithRetry(
  fn: () => Promise<Response>,
  retryOptions: RetryOptions,
  label: string
): Promise<Response> {
  let attempt = 0
  let lastError: unknown

  while (attempt <= retryOptions.retries) {
    try {
      const response = await fn()
      if (!RETRY_STATUS_CODES.has(response.status)) {
        return response
      }

      lastError = new Error(
        `${label} responded with retryable status ${response.status}`
      )
    } catch (error: unknown) {
      lastError = error
    }

    if (attempt === retryOptions.retries) {
      break
    }

    const backoff =
      retryOptions.baseDelayMs * Math.pow(retryOptions.factor, attempt)
    debug(`Retrying ${label} after ${backoff}ms (attempt ${attempt + 1})`)
    await delay(backoff)
    attempt += 1
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`${label} failed after retries`)
}

async function delay(durationMs: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, durationMs)
  })
}
