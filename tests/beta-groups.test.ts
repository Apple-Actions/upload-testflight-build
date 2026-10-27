import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {info, warning} from '@actions/core'
import {mkdtemp, writeFile} from 'fs/promises'
import {tmpdir} from 'os'
import {join} from 'path'
import {
  assignBuildToGroups,
  parseGroupsFileContents,
  parseGroupsInput,
  resolveGroupNames
} from '../src/betaGroups'
import type {ResolvedUploadedBuild} from '../src/utils/resolve-uploaded-build'

const infoMock = vi.hoisted(() => vi.fn())
const warningMock = vi.hoisted(() => vi.fn())
const debugMock = vi.hoisted(() => vi.fn())
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@actions/core', () => ({
  info: infoMock,
  warning: warningMock,
  debug: debugMock
}))

let originalFetch: typeof global.fetch | undefined

function resolvedBuild(): ResolvedUploadedBuild {
  return {
    appId: 'app-id',
    buildId: 'build-id',
    app: {
      bundleId: 'com.example.app',
      buildNumber: '123',
      shortVersion: '1.2.3'
    },
    token: () => 'token',
    platform: 'IOS'
  }
}

describe('group name parsing', () => {
  it('parses comma- and newline-separated groups input', () => {
    expect(parseGroupsInput('QA, Friends & Family\nBeta')).toEqual([
      'QA',
      'Friends & Family',
      'Beta'
    ])
  })

  it('deduplicates and drops empties from groups input', () => {
    expect(parseGroupsInput('QA,, QA\n')).toEqual(['QA'])
  })

  it('parses groups file contents with comments and blanks', () => {
    expect(
      parseGroupsFileContents(`
# Exact App Store Connect TestFlight group names
QA
Friends & Family # external

Beta
`)
    ).toEqual(['QA', 'Friends & Family', 'Beta'])
  })
})

describe('resolveGroupNames', () => {
  it('returns empty when neither source is set', async () => {
    await expect(
      resolveGroupNames({groups: '  ', groupsFile: ''})
    ).resolves.toEqual([])
  })

  it('rejects when both sources are set', async () => {
    await expect(
      resolveGroupNames({groups: 'QA', groupsFile: 'groups.txt'})
    ).rejects.toThrow(/mutually exclusive/)
  })

  it('reads names from groups-file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'groups-file-'))
    const path = join(dir, 'testflight-groups.txt')
    await writeFile(path, 'QA\nFriends & Family\n')

    await expect(
      resolveGroupNames({groups: '', groupsFile: path})
    ).resolves.toEqual(['QA', 'Friends & Family'])
  })

  it('fails when groups-file is missing', async () => {
    await expect(
      resolveGroupNames({
        groups: '',
        groupsFile: '/tmp/does-not-exist-testflight-groups.txt'
      })
    ).rejects.toThrow(/Failed to read groups-file/)
  })

  it('fails when groups-file has no names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'groups-file-empty-'))
    const path = join(dir, 'empty.txt')
    await writeFile(path, '# only comments\n\n')

    await expect(
      resolveGroupNames({groups: '', groupsFile: path})
    ).rejects.toThrow(/did not contain any group names/)
  })
})

describe('assignBuildToGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (!originalFetch) {
      originalFetch = global.fetch
    }
    global.fetch = fetchMock as typeof global.fetch
    fetchMock.mockReset()
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    }
  })

  it('links matched groups and submits beta review when ready', async () => {
    const posts: Array<{url: string; body: unknown}> = []

    fetchMock.mockImplementation(
      async (input: unknown, init?: {method?: string; body?: unknown}) => {
        const url = input instanceof URL ? input : new URL(String(input))
        const method = (init?.method ?? 'GET').toUpperCase()

        if (method === 'POST') {
          posts.push({
            url: url.pathname,
            body: init?.body ? JSON.parse(init.body as string) : undefined
          })
          return {
            ok: true,
            status: 204,
            headers: {get: () => null},
            text: async () => '',
            json: async () => ({})
          }
        }

        let data: unknown = {data: []}
        if (url.pathname.endsWith('/betaGroups')) {
          data = {
            data: [
              {
                id: 'group-internal',
                attributes: {
                  name: 'App Store Connect Users',
                  isInternalGroup: true,
                  hasAccessToAllBuilds: false
                }
              },
              {
                id: 'group-external',
                attributes: {
                  name: 'QA',
                  isInternalGroup: false,
                  hasAccessToAllBuilds: false
                }
              }
            ]
          }
        } else if (url.pathname.endsWith('/buildBetaDetail')) {
          data = {
            data: {
              attributes: {externalBuildState: 'READY_FOR_BETA_SUBMISSION'}
            }
          }
        }

        return {
          ok: true,
          status: 200,
          headers: {get: () => 'application/json'},
          text: async () => JSON.stringify(data),
          json: async () => data
        }
      }
    )

    const outcome = await assignBuildToGroups(
      ['QA', 'App Store Connect Users'],
      resolvedBuild()
    )

    expect(outcome.status).toBe('assigned')
    expect(outcome.summary).toContain('linked to "QA"')
    expect(outcome.summary).toContain('submitted for beta app review')
    expect(posts).toEqual([
      {
        url: '/v1/betaGroups/group-external/relationships/builds',
        body: {data: [{type: 'builds', id: 'build-id'}]}
      },
      {
        url: '/v1/betaGroups/group-internal/relationships/builds',
        body: {data: [{type: 'builds', id: 'build-id'}]}
      },
      {
        url: '/v1/betaAppReviewSubmissions',
        body: {
          data: {
            type: 'betaAppReviewSubmissions',
            relationships: {
              build: {data: {type: 'builds', id: 'build-id'}}
            }
          }
        }
      }
    ])
  })

  it('skips hasAccessToAllBuilds groups and missing review when not ready', async () => {
    fetchMock.mockImplementation(async (input: unknown) => {
      const url = input instanceof URL ? input : new URL(String(input))
      let data: unknown = {data: []}
      if (url.pathname.endsWith('/betaGroups')) {
        data = {
          data: [
            {
              id: 'group-all',
              attributes: {
                name: 'All Builds',
                isInternalGroup: true,
                hasAccessToAllBuilds: true
              }
            }
          ]
        }
      } else if (url.pathname.endsWith('/buildBetaDetail')) {
        data = {
          data: {attributes: {externalBuildState: 'READY_FOR_BETA_TESTING'}}
        }
      }
      return {
        ok: true,
        status: 200,
        headers: {get: () => 'application/json'},
        text: async () => JSON.stringify(data),
        json: async () => data
      }
    })

    const outcome = await assignBuildToGroups(['All Builds'], resolvedBuild())

    expect(outcome.status).toBe('assigned')
    expect(outcome.summary).toContain('hasAccessToAllBuilds')
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('already has access to all builds')
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails when a requested group name is missing', async () => {
    fetchMock.mockImplementation(async () => {
      const data = {
        data: [
          {
            id: 'group-qa',
            attributes: {
              name: 'QA',
              isInternalGroup: false,
              hasAccessToAllBuilds: false
            }
          }
        ]
      }
      return {
        ok: true,
        status: 200,
        headers: {get: () => 'application/json'},
        text: async () => JSON.stringify(data),
        json: async () => data
      }
    })

    await expect(
      assignBuildToGroups(['Missing'], resolvedBuild())
    ).rejects.toThrow(/No TestFlight beta group named "Missing"/)
  })

  it('treats already-linked builds as success', async () => {
    fetchMock.mockImplementation(
      async (_input: unknown, init?: {method?: string; body?: unknown}) => {
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method === 'POST') {
          return {
            ok: false,
            status: 409,
            headers: {get: () => 'application/json'},
            text: async () =>
              JSON.stringify({
                errors: [{code: 'ENTITY_ERROR.RELATIONSHIP.INVALID'}]
              }),
            json: async () => ({})
          }
        }
        const data = {
          data: [
            {
              id: 'group-qa',
              attributes: {
                name: 'QA',
                isInternalGroup: true,
                hasAccessToAllBuilds: false
              }
            }
          ]
        }
        return {
          ok: true,
          status: 200,
          headers: {get: () => 'application/json'},
          text: async () => JSON.stringify(data),
          json: async () => data
        }
      }
    )

    const outcome = await assignBuildToGroups(['QA'], resolvedBuild())
    expect(outcome.status).toBe('assigned')
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('already linked')
    )
  })
})
