import {execFileSync} from 'child_process'
import {existsSync} from 'fs'
import {mkdir, mkdtemp, rm, writeFile} from 'fs/promises'
import {tmpdir} from 'os'
import {dirname, join} from 'path'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {exec} from '@actions/exec'
import {extractAppMetadata} from '../src/utils/appMetadata'

const admZipMock = vi.hoisted(() => vi.fn())

vi.mock('adm-zip', () => ({default: admZipMock}))
vi.mock('@actions/exec', async importOriginal => ({
  ...(await importOriginal<typeof import('@actions/exec')>()),
  exec: vi.fn()
}))

const execMock = vi.mocked(exec)

function plistXml(bundleId: string, build: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleIdentifier</key><string>${bundleId}</string>
    <key>CFBundleVersion</key><string>${build}</string>
    <key>CFBundleShortVersionString</key><string>${version}</string>
  </dict>
</plist>
`
}

async function writeTree(
  root: string,
  files: Record<string, string>
): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), {recursive: true})
    await writeFile(join(root, path), contents)
  }
}

function mockPkgutil(files: Record<string, string>): string[] {
  const outputDirs: string[] = []
  execMock.mockImplementation(async (command, args) => {
    expect(command).toBe('pkgutil')
    expect(args?.[0]).toBe('--expand-full')
    const outputDir = args?.[2] as string
    outputDirs.push(outputDir)
    await writeTree(outputDir, files)
    return 0
  })
  return outputDirs
}

function expectTempDirRemoved(outputDirs: string[]): void {
  expect(outputDirs).toHaveLength(1)
  expect(existsSync(dirname(outputDirs[0]))).toBe(false)
}

describe('extractAppMetadata for .pkg', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the top-level app and ignores nested helper apps', async () => {
    const outputDirs = mockPkgutil({
      'Foo.pkg/Payload/Foo.app/Contents/Library/LoginItems/Helper.app/Contents/Info.plist':
        plistXml('com.example.helper', '7', '9.9'),
      'Foo.pkg/Payload/Foo.app/Contents/Info.plist': plistXml(
        'com.example.mac',
        '42',
        '3.1'
      )
    })

    await expect(extractAppMetadata('/builds/Foo.PKG')).resolves.toEqual({
      bundleId: 'com.example.mac',
      buildNumber: '42',
      shortVersion: '3.1'
    })

    expect(execMock).toHaveBeenCalledWith(
      'pkgutil',
      ['--expand-full', '/builds/Foo.PKG', outputDirs[0]],
      {silent: true}
    )
    expect(admZipMock).not.toHaveBeenCalled()
    expectTempDirRemoved(outputDirs)
  })

  it('rejects when the .pkg has no app bundle', async () => {
    const outputDirs = mockPkgutil({'Foo.pkg/PackageInfo': '<pkg-info/>'})

    await expect(extractAppMetadata('/builds/Foo.pkg')).rejects.toThrow(
      'Unable to locate <App>.app/Contents/Info.plist inside the .pkg.'
    )
    expectTempDirRemoved(outputDirs)
  })

  it('detects a .pkg without the extension by its xar header', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pkg-sniff-'))
    try {
      const pkgPath = join(dir, 'upload')
      await writeFile(pkgPath, Buffer.from('xar!\0\0\0\0'))
      mockPkgutil({
        'Foo.pkg/Payload/Foo.app/Contents/Info.plist': plistXml(
          'com.example.mac',
          '42',
          '3.1'
        )
      })

      await expect(extractAppMetadata(pkgPath)).resolves.toMatchObject({
        bundleId: 'com.example.mac'
      })
      expect(admZipMock).not.toHaveBeenCalled()
    } finally {
      await rm(dir, {recursive: true, force: true})
    }
  })
})

describe.skipIf(process.platform !== 'darwin')(
  'extractAppMetadata with a real .pkg',
  () => {
    it('reads metadata from a pkgbuild component package', async () => {
      const realExec = (
        await vi.importActual<typeof import('@actions/exec')>('@actions/exec')
      ).exec
      execMock.mockImplementation(realExec)

      const dir = await mkdtemp(join(tmpdir(), 'pkg-real-'))
      try {
        await writeTree(join(dir, 'root'), {
          'Foo.app/Contents/Info.plist': plistXml(
            'com.example.real',
            '101',
            '2.0'
          ),
          'Foo.app/Contents/MacOS/Foo': '#!/bin/sh\n'
        })
        const pkgPath = join(dir, 'Foo.pkg')
        execFileSync('pkgbuild', [
          '--root',
          join(dir, 'root'),
          '--identifier',
          'com.example.real.pkg',
          '--install-location',
          '/Applications',
          pkgPath
        ])

        await expect(extractAppMetadata(pkgPath)).resolves.toEqual({
          bundleId: 'com.example.real',
          buildNumber: '101',
          shortVersion: '2.0'
        })
      } finally {
        await rm(dir, {recursive: true, force: true})
      }
    })
  }
)
