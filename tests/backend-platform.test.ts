import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const getInputMock = vi.hoisted(() => vi.fn())
const setOutputMock = vi.hoisted(() => vi.fn())
const setFailedMock = vi.hoisted(() => vi.fn())
const infoMock = vi.hoisted(() => vi.fn())
const debugMock = vi.hoisted(() => vi.fn())
const warningMock = vi.hoisted(() => vi.fn())

const installPrivateKeyMock = vi.hoisted(() => vi.fn())
const deletePrivateKeysMock = vi.hoisted(() => vi.fn())

const appstoreUploadMock = vi.hoisted(() => vi.fn())
const transporterUploadMock = vi.hoisted(() => vi.fn())
const altoolUploadMock = vi.hoisted(() => vi.fn())

function commonInput(name: string): string {
  switch (name) {
    case 'issuer-id':
      return 'issuer'
    case 'api-key-id':
      return 'key'
    case 'api-private-key':
      return 'private'
    case 'app-path':
      return 'app.ipa'
    case 'app-type':
      return 'ios'
    case 'release-notes':
      return ''
    case 'uses-non-exempt-encryption':
      return ''
    case 'wait-for-processing':
      return ''
    default:
      return ''
  }
}

vi.mock('os', () => ({
  platform: vi.fn(() => 'linux')
}))

vi.mock('@actions/core', () => ({
  getInput: getInputMock,
  setOutput: setOutputMock,
  setFailed: setFailedMock,
  info: infoMock,
  debug: debugMock,
  warning: warningMock
}))

vi.mock('../src/utils/keys', () => ({
  installPrivateKey: installPrivateKeyMock,
  deleteAllPrivateKeys: deletePrivateKeysMock
}))

vi.mock('../src/backends/appstore-api', () => ({
  appstoreApi: {
    upload: appstoreUploadMock.mockResolvedValue({backend: 'appstoreApi'})
  }
}))

vi.mock('../src/backends/transporter', () => ({
  transporter: {
    upload: transporterUploadMock.mockResolvedValue({backend: 'transporter'})
  }
}))

vi.mock('../src/backends/altool', () => ({
  altool: {
    upload: altoolUploadMock.mockResolvedValue({backend: 'altool'})
  }
}))

vi.mock('../src/buildMetadata', () => ({
  submitBuildMetadataUpdates: vi.fn().mockResolvedValue(undefined)
}))

describe('backend platform guard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('allows appstoreApi on linux', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'backend') return 'appstore-api'
      return commonInput(name)
    })

    await import('../src/main')
    await new Promise(resolve => setImmediate(resolve))

    expect(setFailedMock).not.toHaveBeenCalled()
    expect(appstoreUploadMock).toHaveBeenCalled()
  })

  it('rejects transporter on linux', async () => {
    getInputMock.mockImplementation((name: string) => {
      if (name === 'backend') return 'transporter'
      return commonInput(name)
    })

    await import('../src/main')
    await new Promise(resolve => setImmediate(resolve))

    expect(setFailedMock).toHaveBeenCalledWith(
      expect.stringContaining('requires a macOS runner')
    )
    expect(transporterUploadMock).not.toHaveBeenCalled()
  })
})
