import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {exec} from '@actions/exec'
import {mkdtemp, readdir} from 'fs/promises'
import {rmRF} from '@actions/io'
import {info, warning} from '@actions/core'
import {createSign} from 'crypto'
import {submitReleaseNotesIfProvided} from '../src/releaseNotes'

const execMock = vi.hoisted(() => vi.fn())
const mkdtempMock = vi.hoisted(() => vi.fn())
const readdirMock = vi.hoisted(() => vi.fn())
const rmRFMock = vi.hoisted(() => vi.fn())
const infoMock = vi.hoisted(() => vi.fn())
const warningMock = vi.hoisted(() => vi.fn())
const debugMock = vi.hoisted(() => vi.fn())
const createSignMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@actions/exec', () => ({exec: execMock}))
vi.mock('fs/promises', () => ({
  mkdtemp: mkdtempMock,
  readdir: readdirMock
}))
vi.mock('@actions/io', () => ({rmRF: rmRFMock}))
vi.mock('@actions/core', () => ({
  info: infoMock,
  warning: warningMock,
  debug: debugMock
}))
vi.mock('crypto', () => ({createSign: createSignMock}))

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

    mkdtempMock.mockResolvedValue('/tmp/upload-testflight-abc')
    readdirMock.mockResolvedValue(['Example.app'])
    rmRFMock.mockResolvedValue(undefined)

    execMock.mockImplementation(
      async (command: string, _args: string[], options) => {
        if (command === 'plutil') {
          options?.listeners?.stdout?.(
            Buffer.from(
              JSON.stringify({
                CFBundleIdentifier: 'com.example.app',
                CFBundleVersion: '123',
                CFBundleShortVersionString: '1.2.3'
              })
            )
          )
        }
        return 0
      }
    )

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

  it('logs and exits early when release notes are not provided', async () => {
    await submitReleaseNotesIfProvided({
      releaseNotes: '   ',
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(info).toHaveBeenCalledWith(
      'No release note provided. Skipping TestFlight metadata update.'
    )
    expect(exec).not.toHaveBeenCalled()
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
          '/apps': {data: [{id: 'app-id'}]},
          '/v1/apps': {data: [{id: 'app-id'}]},
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

    await submitReleaseNotesIfProvided({
      releaseNotes: longNotes,
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(mkdtemp).toHaveBeenCalledWith(
      expect.stringContaining('upload-testflight-')
    )
    expect(readdir).toHaveBeenCalledWith('/tmp/upload-testflight-abc/Payload')
    expect(exec).toHaveBeenCalledWith(
      'ditto',
      ['-xk', 'path/to/app.ipa', '/tmp/upload-testflight-abc'],
      expect.objectContaining({silent: true})
    )
    expect(exec).toHaveBeenCalledWith(
      'plutil',
      [
        '-convert',
        'json',
        '-o',
        '-',
        '/tmp/upload-testflight-abc/Payload/Example.app/Info.plist'
      ],
      expect.objectContaining({silent: true, listeners: expect.any(Object)})
    )
    expect(rmRF).toHaveBeenCalledWith('/tmp/upload-testflight-abc')

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
})
