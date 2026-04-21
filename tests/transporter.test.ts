import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import type {ExecOptions} from '@actions/exec/lib/interfaces'
import {exec} from '@actions/exec'
import {mkdirP, rmRF} from '@actions/io'
import {writeFileSync} from 'fs'
import {uploadApp} from '../src/backends/transporter'
import {installPrivateKey, deleteAllPrivateKeys} from '../src/utils/keys'

vi.mock('@actions/exec', () => ({
  exec: vi.fn().mockResolvedValue(0)
}))

vi.mock('@actions/io', () => ({
  mkdirP: vi.fn().mockResolvedValue(undefined),
  rmRF: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('fs', () => ({
  writeFileSync: vi.fn()
}))

const execMock = vi.mocked(exec)
const mkdirPMock = vi.mocked(mkdirP)
const rmRFMock = vi.mocked(rmRF)
const writeFileSyncMock = vi.mocked(writeFileSync)

describe('transporter utilities', () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HOME = '/tmp/test-home'
  })

  it('invokes iTMSTransporter with platform when provided', async () => {
    await uploadApp('path/to/app.ipa', 'ios', 'KEY123', 'ISSUER456', undefined)

    expect(execMock).toHaveBeenCalledWith(
      '/usr/local/itms/bin/iTMSTransporter',
      [
        '-m',
        'upload',
        '-assetFile',
        'path/to/app.ipa',
        '-apiKey',
        'KEY123',
        '-apiIssuer',
        'ISSUER456',
        '-v',
        'eXtreme',
        '-appPlatform',
        'ios'
      ],
      undefined
    )
  })

  it('omits app platform argument when not provided', async () => {
    await uploadApp('path/to/app.ipa', '', 'KEY123', 'ISSUER456', undefined)

    expect(execMock).toHaveBeenCalledTimes(1)
    const [, args] = execMock.mock.calls[0]
    expect(args).not.toContain('-appPlatform')
  })

  it('forwards exec options when supplied', async () => {
    const options: ExecOptions = {cwd: '/tmp'}

    await uploadApp(
      'path/to/app.ipa',
      '',
      'KEY123',
      'ISSUER456',
      undefined,
      options
    )

    expect(execMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      options
    )
  })

  it('uses custom transporter executable path when provided', async () => {
    await uploadApp(
      'path/to/app.ipa',
      'ios',
      'KEY123',
      'ISSUER456',
      '/custom/iTMSTransporter',
      undefined
    )

    expect(execMock).toHaveBeenCalledWith(
      '/custom/iTMSTransporter',
      expect.any(Array),
      undefined
    )
  })

  it('falls back to default path when custom path is blank', async () => {
    await uploadApp(
      'path/to/app.ipa',
      'ios',
      'KEY123',
      'ISSUER456',
      '   ',
      undefined
    )

    expect(execMock).toHaveBeenCalledWith(
      '/usr/local/itms/bin/iTMSTransporter',
      expect.any(Array),
      undefined
    )
  })

  it('creates private key file inside HOME/private_keys', async () => {
    await installPrivateKey('KEY123', 'FAKE_KEY')

    expect(mkdirPMock).toHaveBeenCalledWith('/tmp/test-home/private_keys')
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      '/tmp/test-home/private_keys/AuthKey_KEY123.p8',
      'FAKE_KEY'
    )
  })

  it('throws when HOME environment variable is unset', async () => {
    delete process.env.HOME

    await expect(installPrivateKey('KEY123', 'FAKE_KEY')).rejects.toThrow(
      'Unable to determine user HOME path'
    )
    expect(mkdirPMock).not.toHaveBeenCalled()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('removes the private key directory on cleanup', async () => {
    await deleteAllPrivateKeys()

    expect(rmRFMock).toHaveBeenCalledWith('/tmp/test-home/private_keys')
  })

  afterAll(() => {
    process.env.HOME = originalHome
  })
})
