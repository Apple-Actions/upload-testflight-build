import {afterEach, describe, expect, it, vi} from 'vitest'
import {exec} from '@actions/exec'
import {altool} from '../src/backends/altool'
import type {ExecOptions} from '@actions/exec/lib/interfaces'

vi.mock('@actions/exec', () => ({exec: vi.fn().mockResolvedValue(0)}))

const execMock = vi.mocked(exec)

describe('altool backend', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls xcrun altool with required args', async () => {
    await altool.upload(
      {
        appPath: 'path/to/app.ipa',
        appType: 'ios',
        apiKeyId: 'KEY123',
        issuerId: 'ISSUER456',
        apiPrivateKey: 'PRIVATE'
      },
      undefined
    )

    expect(execMock).toHaveBeenCalledWith(
      'xcrun',
      [
        'altool',
        '--upload-app',
        '--file',
        'path/to/app.ipa',
        '--type',
        'ios',
        '--apiKey',
        'KEY123',
        '--apiIssuer',
        'ISSUER456',
        '--verbose'
      ],
      undefined
    )
  })

  it('forwards exec options', async () => {
    const options: ExecOptions = {cwd: '/tmp/app'}

    await altool.upload(
      {
        appPath: 'path/to/app.ipa',
        appType: 'ios',
        apiKeyId: 'KEY123',
        issuerId: 'ISSUER456',
        apiPrivateKey: 'PRIVATE'
      },
      options
    )

    expect(execMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      options
    )
  })
})
