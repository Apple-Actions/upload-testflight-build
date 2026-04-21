import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {info, warning} from '@actions/core'
import {createSign} from 'crypto'
import {submitBuildMetadataUpdates} from '../src/buildMetadata'

const infoMock = vi.hoisted(() => vi.fn())
const warningMock = vi.hoisted(() => vi.fn())
const debugMock = vi.hoisted(() => vi.fn())
const createSignMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())
const admZipMock = vi.hoisted(() => vi.fn())
const execMock = vi.hoisted(() => vi.fn())

vi.mock('@actions/core', () => ({
  info: infoMock,
  warning: warningMock,
  debug: debugMock
}))
vi.mock('crypto', () => ({createSign: createSignMock}))
vi.mock('adm-zip', () => ({default: admZipMock}))
vi.mock('@actions/exec', () => ({exec: execMock}))

let originalFetch: typeof global.fetch | undefined

describe('release notes submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    if (!originalFetch) {
      originalFetch = global.fetch
    }
    global.fetch = fetchMock as typeof global.fetch

    createSignMock.mockImplementation(() => ({
      update: vi.fn(),
      end: vi.fn(),
      sign: vi.fn(() => Buffer.from('signature'))
    }))

    const plistXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
      <plist version="1.0">
        <dict>
          <key>CFBundleIdentifier</key><string>com.example.app</string>
          <key>CFBundleVersion</key><string>123</string>
          <key>CFBundleShortVersionString</key><string>1.2.3</string>
        </dict>
      </plist>
    `
    admZipMock.mockImplementation(function FakeZip() {
      return {
        getEntries: () => [
          {
            entryName: 'Payload/Example.app/Info.plist',
            getData: () => Buffer.from(plistXml)
          }
        ]
      }
    })

    fetchMock.mockReset()
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    }
  })

  afterAll(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    }
  })

  it('logs and exits early when neither release notes nor encryption flag provided', async () => {
    await submitBuildMetadataUpdates({
      releaseNotes: '   ',
      usesNonExemptEncryptionInput: undefined,
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(info).toHaveBeenCalledWith(
      'No release note or encryption compliance requested. Skipping TestFlight metadata update.'
    )
    expect(execMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('collects metadata and updates TestFlight release notes when provided', async () => {
    const longNotes = `  ${'A'.repeat(4050)}  `
    const observedAuthHeaders: string[] = []
    let observedPatchBody: unknown

    fetchMock.mockImplementation(
      async (
        input: unknown,
        init?: {
          method?: string
          headers?: Record<string, string>
          body?: unknown
        }
      ) => {
        const url = input instanceof URL ? input : new URL(String(input))
        const method = (init?.method ?? 'GET').toUpperCase()

        const authorizationHeader =
          init?.headers?.Authorization ?? init?.headers?.authorization ?? ''
        observedAuthHeaders.push(authorizationHeader)

        if (method === 'PATCH') {
          observedPatchBody = init?.body
            ? JSON.parse(init.body as string)
            : undefined
          return {
            ok: true,
            status: 200,
            headers: {get: () => 'application/json'},
            json: async () => ({}),
            text: async () => '{}'
          }
        }

        const responseQueue: Record<string, unknown> = {
          '/apps': {
            data: [{id: 'app-id', attributes: {bundleId: 'com.example.app'}}]
          },
          '/v1/apps': {
            data: [{id: 'app-id', attributes: {bundleId: 'com.example.app'}}]
          },
          '/builds': {data: [{id: 'build-id'}]},
          '/v1/builds': {data: [{id: 'build-id'}]},
          '/builds/build-id/betaBuildLocalizations': {data: [{id: 'loc-id'}]},
          '/v1/builds/build-id/betaBuildLocalizations': {data: [{id: 'loc-id'}]}
        }

        const data = responseQueue[
          url.pathname as keyof typeof responseQueue
        ] ?? {
          data: []
        }

        return {
          ok: true,
          status: 200,
          headers: {get: () => 'application/json'},
          json: async () => data,
          text: async () => JSON.stringify(data)
        }
      }
    )

    await submitBuildMetadataUpdates({
      releaseNotes: longNotes,
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(
      observedAuthHeaders.every(header => header.startsWith('Bearer '))
    ).toBe(true)

    const patchPayload = observedPatchBody as {
      data: {attributes: {whatsNew: string}}
    }
    expect(patchPayload.data.attributes.whatsNew.length).toBe(4000)
    expect(patchPayload.data.attributes.whatsNew).toBe('A'.repeat(4000))

    expect(info).toHaveBeenCalledWith(
      'Successfully updated TestFlight release note.'
    )
    expect(warning).not.toHaveBeenCalled()
    expect(createSign).toHaveBeenCalledWith('SHA256')
  })

  it('updates only encryption compliance when release notes are empty but flag is provided', async () => {
    const observedPatchBody: unknown[] = []

    fetchMock.mockImplementation(
      async (
        input: unknown,
        init?: {
          method?: string
          headers?: Record<string, string>
          body?: unknown
        }
      ) => {
        const url = input instanceof URL ? input : new URL(String(input))
        const method = (init?.method ?? 'GET').toUpperCase()

        if (method === 'PATCH') {
          observedPatchBody.push(
            init?.body ? JSON.parse(init.body as string) : undefined
          )
          return {
            ok: true,
            status: 200,
            headers: {get: () => 'application/json'},
            json: async () => ({}),
            text: async () => '{}'
          }
        }

        const path = url.pathname
        const data =
          path === '/apps' || path === '/v1/apps'
            ? {
                data: [
                  {id: 'app-id', attributes: {bundleId: 'com.example.app'}}
                ]
              }
            : path === '/builds' || path === '/v1/builds'
              ? {data: [{id: 'build-id'}]}
              : {data: []}

        return {
          ok: true,
          status: 200,
          headers: {get: () => 'application/json'},
          json: async () => data,
          text: async () => JSON.stringify(data)
        }
      }
    )

    await submitBuildMetadataUpdates({
      releaseNotes: '   ',
      usesNonExemptEncryptionInput: 'false',
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(execMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const patchPayload = observedPatchBody[0] as {
      data: {attributes: {usesNonExemptEncryption: boolean}}
    }
    expect(patchPayload.data.attributes.usesNonExemptEncryption).toBe(false)
  })
})
