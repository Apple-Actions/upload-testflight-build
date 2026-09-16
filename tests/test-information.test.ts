import {execFile} from 'node:child_process'
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {describe, expect, it} from 'vitest'

const execFileAsync = promisify(execFile)
const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const script = join(repoRoot, 'scripts/populate-test-information.sh')

describe('scripts/populate-test-information.sh', () => {
  async function repo(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'test-information-'))
    for (const [rel, contents] of Object.entries(files)) {
      const full = join(dir, rel)
      await mkdir(dirname(full), {recursive: true})
      await writeFile(full, contents)
    }
    return dir
  }

  async function preview(
    dir: string,
    extraArgs: string[] = []
  ): Promise<{stdout: string; stderr: string; code: number}> {
    try {
      const result = await execFileAsync(
        'bash',
        [script, '--dir', dir, ...extraArgs],
        {
          encoding: 'utf8'
        }
      )
      return {stdout: result.stdout, stderr: result.stderr, code: 0}
    } catch (error: unknown) {
      const err = error as {stdout?: string; stderr?: string; code?: number}
      return {
        stdout: err.stdout ?? '',
        stderr: err.stderr ?? '',
        code: err.code ?? 1
      }
    }
  }

  function previewPayload(stdout: string): Record<string, unknown> {
    const match = stdout.match(/\{[\s\S]*\}/)
    if (!match) {
      throw new Error(`preview stdout did not include JSON: ${stdout}`)
    }
    return JSON.parse(match[0]) as Record<string, unknown>
  }

  it('prints usage without requiring credentials', async () => {
    const {stdout} = await execFileAsync('bash', [script, '--help'], {
      encoding: 'utf8'
    })
    expect(stdout).toContain('--apply')
  })

  it('reads a config file over inferred package.json values', async () => {
    const dir = await repo({
      'package.json': JSON.stringify({
        description: 'Package description that is long enough',
        author: 'Dev <dev@example.com>'
      }),
      '.apple-actions/test-information.json': JSON.stringify({
        bundleId: 'com.example.app',
        locale: 'en-GB',
        description: 'Config description',
        feedbackEmail: 'qa@example.com'
      })
    })

    const {stdout, code} = await preview(dir)
    expect(code).toBe(0)
    expect(stdout).toContain('Would write TestFlight Test Information:')
    expect(stdout).toContain('--apply')
    const result = previewPayload(stdout) as Record<string, unknown>
    expect(result).toMatchObject({
      bundleId: 'com.example.app',
      locale: 'en-GB',
      description: 'Config description',
      feedbackEmail: 'qa@example.com'
    })
    expect(
      String((result.sources as Record<string, string>).bundleId)
    ).toContain('test-information.json')
  })

  it('infers Expo bundle id, package description, and author email', async () => {
    const dir = await repo({
      'app.json': JSON.stringify({
        expo: {
          ios: {bundleIdentifier: 'com.example.expo'},
          description: 'Expo app description that testers should see'
        }
      }),
      'package.json': JSON.stringify({
        author: {email: 'author@example.com'}
      })
    })

    const {stdout, code} = await preview(dir)
    expect(code).toBe(0)
    const result = previewPayload(stdout) as {
      bundleId: string
      description: string
      feedbackEmail: string
      locale: string
    }
    expect(result.bundleId).toBe('com.example.expo')
    expect(result.description).toContain('Expo app description')
    expect(result.feedbackEmail).toBe('author@example.com')
    expect(result.locale).toBe('en-US')
  })

  it('reads bundle id and locale from Info.plist', async () => {
    const dir = await repo({
      'ios/App/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleIdentifier</key><string>com.example.plist</string>
    <key>CFBundleDevelopmentRegion</key><string>en</string>
    <key>CFBundleDisplayName</key><string>Example</string>
  </dict>
</plist>
`,
      'package.json': JSON.stringify({
        author: 'QA <qa@example.com>'
      })
    })

    const {stdout, code} = await preview(dir)
    expect(code).toBe(0)
    const result = previewPayload(stdout) as {
      bundleId: string
      locale: string
      feedbackEmail: string
      description: string
    }
    expect(result.bundleId).toBe('com.example.plist')
    expect(result.locale).toBe('en-US')
    expect(result.feedbackEmail).toBe('qa@example.com')
    expect(result.description).toBe('Beta of Example.')
  })

  it('lets CLI overrides fill missing fields', async () => {
    const dir = await repo({})
    const {stdout, code} = await preview(dir, [
      '--bundle-id',
      'com.example.cli',
      '--description',
      'CLI description for testers to read',
      '--feedback-email',
      'cli@example.com',
      '--locale',
      'fr-FR'
    ])
    expect(code).toBe(0)
    const result = previewPayload(stdout) as {
      bundleId: string
      locale: string
      sources: Record<string, string>
    }
    expect(result.bundleId).toBe('com.example.cli')
    expect(result.locale).toBe('fr-FR')
    expect(result.sources.bundleId).toBe('cli')
  })

  it('explains how to add a config file when required fields are missing', async () => {
    const dir = await repo({})
    const {stderr, code} = await preview(dir)
    expect(code).toBe(1)
    expect(stderr).toMatch(/missing: bundleId, description, feedbackEmail/)
    expect(stderr).toContain('.apple-actions/test-information.json')
  })

  it('prefers Shared.xcconfig over test and flavor bundle ids', async () => {
    const dir = await repo({
      'Config/Shared.xcconfig': 'PRODUCT_BUNDLE_IDENTIFIER = com.example.app\n',
      'ios/App.xcodeproj/project.pbxproj': `
        PRODUCT_BUNDLE_IDENTIFIER = com.example.app.tests;
        PRODUCT_BUNDLE_IDENTIFIER = com.example.other;
      `,
      'ios/App/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDisplayName</key><string>Example</string>
  </dict>
</plist>
`,
      'app/help.tsx': 'Linking.openURL("mailto:ios-support@example-app.com")\n'
    })

    const {stdout, code} = await preview(dir)
    expect(code).toBe(0)
    const result = previewPayload(stdout) as {
      bundleId: string
      description: string
      feedbackEmail: string
      sources: Record<string, string>
    }
    expect(result.bundleId).toBe('com.example.app')
    expect(result.sources.bundleId).toContain('Shared.xcconfig')
    expect(result.description).toBe('Beta of Example.')
    expect(result.feedbackEmail).toBe('ios-support@example-app.com')
  })

  it('ignores README HTML comments and Ignite boilerplate', async () => {
    const dir = await repo({
      'README.md': `# App

<!-- managed:ios-release-buttons:begin — synced from elsewhere -->
[![Promote to TestFlight](https://img.shields.io/badge/x-y)](https://example.com)
Actions → **Run workflow**. Promote opens the PR.
<!-- managed:ios-release-buttons:end -->

This is the boilerplate that Infinite Red uses as a way to test bleeding-edge changes.
`,
      'package.json': JSON.stringify({name: 'Decade'}),
      'Config/Shared.xcconfig':
        'PRODUCT_BUNDLE_IDENTIFIER = com.birdiefire.decade\n',
      'app/help.ts': 'mailto:support@birdiefire.com\n'
    })

    const {stdout, code} = await preview(dir)
    expect(code).toBe(0)
    const result = previewPayload(stdout) as {
      description: string
      bundleId: string
    }
    expect(result.bundleId).toBe('com.birdiefire.decade')
    expect(result.description).toBe('Beta of Decade.')
    expect(result.description).not.toContain('managed:ios-release-buttons')
  })

  it('requires credential flags with --apply', async () => {
    const dir = await repo({
      '.apple-actions/test-information.json': JSON.stringify({
        bundleId: 'com.example.app',
        description: 'Help us test the latest beta.',
        feedbackEmail: 'qa@example.com'
      })
    })
    try {
      await execFileAsync('bash', [script, '--dir', dir, '--apply'], {
        encoding: 'utf8'
      })
      throw new Error('expected missing --issuer-id to fail')
    } catch (error: unknown) {
      const err = error as {stderr?: string}
      expect(err.stderr).toContain('Missing required --issuer-id')
    }
  })
})
