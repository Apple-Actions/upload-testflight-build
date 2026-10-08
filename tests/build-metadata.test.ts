import {afterAll, afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {info, warning} from '@actions/core'
import {createSign} from 'crypto'
import {mkdir, writeFile} from 'fs/promises'
import {join} from 'path'
import {
  prepareBuildMetadata,
  submitBuildMetadataUpdates
} from '../src/buildMetadata'

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

async function prepareAndSubmit(
  params: Parameters<typeof prepareBuildMetadata>[0] &
    Parameters<typeof submitBuildMetadataUpdates>[1]
): ReturnType<typeof submitBuildMetadataUpdates> {
  return submitBuildMetadataUpdates(await prepareBuildMetadata(params), params)
}

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

    const plistXml = `<?xml version="1.0" encoding="UTF-8"?>
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
    const outcome = await prepareAndSubmit({
      releaseNotes: '   ',
      usesNonExemptEncryptionInput: undefined,
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(outcome.status).toBe('skipped')
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
          '/apps/app-id/betaAppLocalizations': {
            data: [{id: 'app-loc-id', attributes: {locale: 'en-US'}}]
          },
          '/v1/apps/app-id/betaAppLocalizations': {
            data: [{id: 'app-loc-id', attributes: {locale: 'en-US'}}]
          },
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

    const outcome = await prepareAndSubmit({
      releaseNotes: longNotes,
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(outcome).toEqual({
      status: 'notes-updated',
      summary: 'Updated existing TestFlight release note for build build-id.'
    })
    expect(fetchMock).toHaveBeenCalledTimes(5)
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

    const outcome = await prepareAndSubmit({
      releaseNotes: '   ',
      usesNonExemptEncryptionInput: 'false',
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(outcome).toEqual({
      status: 'encryption-only',
      summary: 'No release notes requested. Set usesNonExemptEncryption=false.'
    })
    expect(execMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const patchPayload = observedPatchBody[0] as {
      data: {attributes: {usesNonExemptEncryption: boolean}}
    }
    expect(patchPayload.data.attributes.usesNonExemptEncryption).toBe(false)
  })

  it('fails fast when Test Information is missing', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input))
      const path = url.pathname

      const data =
        path === '/apps' || path === '/v1/apps'
          ? {
              data: [{id: 'app-id', attributes: {bundleId: 'com.example.app'}}]
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
    })

    await expect(
      prepareAndSubmit({
        releaseNotes: 'What to test',
        appPath: 'path/to/app.ipa',
        appType: 'ios',
        issuerId: 'issuer-id',
        apiKeyId: 'api-key-id',
        apiPrivateKey: 'PRIVATE_KEY'
      })
    ).rejects.toThrow(
      /The build already uploaded, but attaching TestFlight "What to Test" failed[\s\S]*Test Information is missing[\s\S]*Fill App Store Connect → TestFlight → Test Information/
    )

    const buildLocalizationGets = fetchMock.mock.calls.filter(
      (call: unknown[]) => {
        const url = String(call[0])
        const method = (
          (call[1] as {method?: string} | undefined)?.method ?? 'GET'
        ).toUpperCase()
        return method === 'GET' && url.includes('betaBuildLocalizations')
      }
    )
    expect(buildLocalizationGets).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('creates a beta build localization when none exists', async () => {
    let observedPostBody: unknown

    fetchMock.mockImplementation(
      async (
        input: unknown,
        init?: {
          method?: string
          body?: unknown
        }
      ) => {
        const url = input instanceof URL ? input : new URL(String(input))
        const method = (init?.method ?? 'GET').toUpperCase()

        if (method === 'POST') {
          observedPostBody = init?.body
            ? JSON.parse(init.body as string)
            : undefined
          return {
            ok: true,
            status: 201,
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
              : path.endsWith('/betaAppLocalizations')
                ? {
                    data: [{id: 'app-loc-id', attributes: {locale: 'en-US'}}]
                  }
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

    const outcome = await prepareAndSubmit({
      releaseNotes: 'What testers should look at',
      appPath: 'path/to/app.ipa',
      appType: 'ios',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(outcome).toEqual({
      status: 'notes-created',
      summary: 'Created TestFlight release note for build build-id.'
    })

    const postPayload = observedPostBody as {
      data: {
        type: string
        attributes: {locale: string; whatsNew: string}
        relationships: {build: {data: {type: string; id: string}}}
      }
    }
    expect(postPayload.data.type).toBe('betaBuildLocalizations')
    expect(postPayload.data.attributes.locale).toBe('en-US')
    expect(postPayload.data.attributes.whatsNew).toBe(
      'What testers should look at'
    )
    expect(postPayload.data.relationships.build.data).toEqual({
      type: 'builds',
      id: 'build-id'
    })
    expect(info).toHaveBeenCalledWith(
      'Successfully created TestFlight release note.'
    )
  })

  it('reads a macOS .pkg and looks up the MAC_OS build', async () => {
    const macPlistXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
  <dict>
    <key>CFBundleIdentifier</key><string>com.example.mac</string>
    <key>CFBundleVersion</key><string>42</string>
    <key>CFBundleShortVersionString</key><string>3.1</string>
  </dict>
</plist>
`
    execMock.mockImplementation(async (_command: string, args: string[]) => {
      const appContents = join(args[2], 'Foo.pkg/Payload/Foo.app/Contents')
      await mkdir(appContents, {recursive: true})
      await writeFile(join(appContents, 'Info.plist'), macPlistXml)
      return 0
    })

    const requestedUrls: URL[] = []
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input))
      requestedUrls.push(url)
      const path = url.pathname
      const data =
        path === '/apps' || path === '/v1/apps'
          ? {
              data: [{id: 'app-id', attributes: {bundleId: 'com.example.mac'}}]
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
    })

    const outcome = await prepareAndSubmit({
      releaseNotes: '',
      usesNonExemptEncryptionInput: 'false',
      appPath: '/builds/ScoreboardNDI.pkg',
      appType: 'macos',
      issuerId: 'issuer-id',
      apiKeyId: 'api-key-id',
      apiPrivateKey: 'PRIVATE_KEY'
    })

    expect(outcome.status).toBe('encryption-only')
    expect(admZipMock).not.toHaveBeenCalled()
    expect(execMock).toHaveBeenCalledWith(
      'pkgutil',
      ['--expand-full', '/builds/ScoreboardNDI.pkg', expect.any(String)],
      {silent: true}
    )

    const appsUrl = requestedUrls.find(url => url.pathname.endsWith('/apps'))
    expect(appsUrl?.searchParams.get('filter[bundleId]')).toBe(
      'com.example.mac'
    )
    const buildsUrl = requestedUrls.find(url =>
      url.pathname.endsWith('/builds')
    )
    expect(buildsUrl?.searchParams.get('filter[version]')).toBe('42')
    expect(
      buildsUrl?.searchParams.get('filter[preReleaseVersion.platform]')
    ).toBe('MAC_OS')
  })

  it('rejects an invalid encryption value before reading the app', async () => {
    await expect(
      prepareBuildMetadata({
        releaseNotes: 'Notes',
        usesNonExemptEncryptionInput: 'maybe',
        appPath: 'path/to/app.ipa'
      })
    ).rejects.toThrow('Invalid uses-non-exempt-encryption value "maybe"')

    expect(admZipMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips without reading the app when wait-for-processing is false', async () => {
    const plan = await prepareBuildMetadata({
      releaseNotes: 'Notes',
      appPath: 'path/to/app.ipa',
      waitForProcessing: false
    })

    expect(plan).toEqual({
      skip: {
        status: 'skipped',
        summary:
          'TestFlight metadata skipped: wait-for-processing=false, so release notes and encryption compliance were not applied.'
      }
    })
    expect(admZipMock).not.toHaveBeenCalled()
  })

  it('reads app metadata during prepare, before any App Store Connect call', async () => {
    const plan = await prepareBuildMetadata({
      releaseNotes: '  Notes  ',
      usesNonExemptEncryptionInput: 'true',
      appPath: 'path/to/app.ipa'
    })

    expect(plan).toEqual({
      releaseNotes: 'Notes',
      usesNonExemptEncryption: true,
      app: {
        bundleId: 'com.example.app',
        buildNumber: '123',
        shortVersion: '1.2.3'
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
