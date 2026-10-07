import {join} from 'path'
import {warning} from '@actions/core'
import {rmRF} from '@actions/io'
import {watchedExec, type StuckReason} from '../utils/watched-exec'
import {UploadParams, UploadResult, Uploader} from './types'

const DEFAULT_UPLOAD_ATTEMPTS = 2

const STUCK_DESCRIPTIONS: Record<StuckReason, string> = {
  'retry-loop': 'stuck retrying the same upload part',
  timeout: 'exceeded upload-timeout-minutes'
}

function resumeStatePath(): string {
  return join(
    process.env['HOME'] || '',
    'Library/Application Support/com.apple.itunes.altool/CDUploads'
  )
}

export const altool: Uploader = {
  async upload(params: UploadParams): Promise<UploadResult> {
    const args: string[] = [
      'altool',
      '--upload-app',
      '--file',
      params.appPath,
      '--type',
      params.appType,
      '--apiKey',
      params.apiKeyId,
      '--apiIssuer',
      params.issuerId,
      '--verbose'
    ]

    const attempts = params.uploadAttempts ?? DEFAULT_UPLOAD_ATTEMPTS
    const timeoutMs =
      params.uploadTimeoutMinutes !== undefined
        ? params.uploadTimeoutMinutes * 60_000
        : undefined

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const {exitCode, stuckReason} = await watchedExec('xcrun', args, {
        timeoutMs
      })

      if (!stuckReason) {
        if (exitCode !== 0) {
          throw new Error(`altool failed with exit code ${exitCode}`)
        }
        return {backend: 'altool'}
      }

      const description = STUCK_DESCRIPTIONS[stuckReason]
      if (attempt === attempts) {
        throw new Error(
          `altool upload ${description} on all ${attempts} attempt(s), so the upload did not complete. Re-run the job, and bump the build number if App Store Connect rejects it as a duplicate.`
        )
      }

      warning(
        `altool upload ${description} (attempt ${attempt}/${attempts}); clearing resume state and retrying.`
      )
      await rmRF(resumeStatePath())
    }

    throw new Error('altool upload was not attempted (upload-attempts < 1).')
  }
}
