import {afterAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {warning} from '@actions/core'
import {rmRF} from '@actions/io'
import {altool} from '../src/backends/altool'
import {generateJwt} from '../src/auth/jwt'
import {fetchJson} from '../src/utils/http'
import {watchedExec} from '../src/utils/watched-exec'

vi.mock('@actions/core', () => ({warning: vi.fn(), info: vi.fn()}))
vi.mock('@actions/io', () => ({rmRF: vi.fn().mockResolvedValue(undefined)}))
vi.mock('../src/utils/watched-exec', () => ({watchedExec: vi.fn()}))
vi.mock('../src/utils/http', () => ({fetchJson: vi.fn()}))
vi.mock('../src/auth/jwt', () => ({generateJwt: vi.fn(() => 'JWT')}))

const watchedExecMock = vi.mocked(watchedExec)
const rmRFMock = vi.mocked(rmRF)
const fetchJsonMock = vi.mocked(fetchJson)
const generateJwtMock = vi.mocked(generateJwt)
const warningMock = vi.mocked(warning)

const uploadId = '8d3f6ff2-0088-43c8-ad30-b0ac32761083'

const params = {
  appPath: 'path/to/app.ipa',
  appType: 'ios',
  apiKeyId: 'KEY123',
  issuerId: 'ISSUER456',
  apiPrivateKey: 'PRIVATE'
}

const resumeState =
  '/tmp/test-home/Library/Application Support/com.apple.itunes.altool/CDUploads'

describe('altool backend', () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.HOME = '/tmp/test-home'
  })

  afterAll(() => {
    process.env.HOME = originalHome
  })

  it('calls xcrun altool with required args', async () => {
    watchedExecMock.mockResolvedValueOnce({exitCode: 0})

    await expect(altool.upload(params)).resolves.toEqual({backend: 'altool'})

    expect(watchedExecMock).toHaveBeenCalledWith(
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
      {timeoutMs: undefined}
    )
    expect(rmRFMock).not.toHaveBeenCalled()
  })

  it('passes upload-timeout-minutes as milliseconds', async () => {
    watchedExecMock.mockResolvedValueOnce({exitCode: 0})

    await altool.upload({...params, uploadTimeoutMinutes: 15})

    expect(watchedExecMock).toHaveBeenCalledWith('xcrun', expect.any(Array), {
      timeoutMs: 900_000
    })
  })

  it('clears resume state and retries after a stuck upload', async () => {
    watchedExecMock
      .mockResolvedValueOnce({exitCode: 1, stuckReason: 'retry-loop'})
      .mockResolvedValueOnce({exitCode: 0})

    await expect(altool.upload(params)).resolves.toEqual({backend: 'altool'})

    expect(watchedExecMock).toHaveBeenCalledTimes(2)
    expect(rmRFMock).toHaveBeenCalledWith(resumeState)
  })

  it('fails after the last stuck attempt', async () => {
    watchedExecMock.mockResolvedValue({exitCode: 1, stuckReason: 'timeout'})

    await expect(altool.upload({...params, uploadAttempts: 3})).rejects.toThrow(
      'altool upload exceeded upload-timeout-minutes on all 3 attempt(s)'
    )

    expect(watchedExecMock).toHaveBeenCalledTimes(3)
    expect(rmRFMock).toHaveBeenCalledTimes(2)
  })

  it('deletes the abandoned build upload before retrying', async () => {
    fetchJsonMock.mockResolvedValueOnce({})
    watchedExecMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stuckReason: 'retry-loop',
        buildUploadId: uploadId
      })
      .mockResolvedValueOnce({exitCode: 0})

    await expect(altool.upload(params)).resolves.toEqual({backend: 'altool'})

    expect(fetchJsonMock).toHaveBeenCalledWith(
      `/buildUploads/${uploadId}`,
      expect.any(Function),
      'Failed to delete abandoned build upload',
      'DELETE'
    )
    const tokenSource = fetchJsonMock.mock.calls[0][1] as () => string
    expect(tokenSource()).toBe('JWT')
    expect(generateJwtMock).toHaveBeenCalledWith(
      'ISSUER456',
      'KEY123',
      'PRIVATE'
    )
    expect(fetchJsonMock.mock.invocationCallOrder[0]).toBeLessThan(
      watchedExecMock.mock.invocationCallOrder[1]
    )
  })

  it('still retries when deleting the build upload fails', async () => {
    fetchJsonMock.mockRejectedValueOnce(new Error('boom (403)'))
    watchedExecMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stuckReason: 'retry-loop',
        buildUploadId: uploadId
      })
      .mockResolvedValueOnce({exitCode: 0})

    await expect(altool.upload(params)).resolves.toEqual({backend: 'altool'})

    expect(warningMock).toHaveBeenCalledWith(
      `Could not delete abandoned build upload ${uploadId}: boom (403)`
    )
    expect(watchedExecMock).toHaveBeenCalledTimes(2)
  })

  it('deletes the build upload after the last stuck attempt too', async () => {
    fetchJsonMock.mockResolvedValue({})
    watchedExecMock.mockResolvedValue({
      exitCode: 1,
      stuckReason: 'retry-loop',
      buildUploadId: uploadId
    })

    await expect(altool.upload(params)).rejects.toThrow(
      'stuck retrying the same upload part on all 2 attempt(s)'
    )

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  it('skips the delete when no build upload ID was seen', async () => {
    watchedExecMock
      .mockResolvedValueOnce({exitCode: 1, stuckReason: 'timeout'})
      .mockResolvedValueOnce({exitCode: 0})

    await altool.upload(params)

    expect(fetchJsonMock).not.toHaveBeenCalled()
  })

  it('does not retry a normal altool failure', async () => {
    watchedExecMock.mockResolvedValueOnce({exitCode: 176})

    await expect(altool.upload(params)).rejects.toThrow(
      'altool failed with exit code 176'
    )

    expect(watchedExecMock).toHaveBeenCalledTimes(1)
    expect(rmRFMock).not.toHaveBeenCalled()
  })
})
