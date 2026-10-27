import {warning} from '@actions/core'
import {generateJwt} from '../auth/jwt'
import {extractAppMetadata, type AppMetadata} from './appMetadata'
import {buildPlatform, type TokenSource} from './http'
import {lookupAppId} from './lookup-app-id'
import {lookupBuildIdWithRetry} from './buildLookup'

export type ResolvedUploadedBuild = {
  appId: string
  buildId: string
  app: AppMetadata
  token: TokenSource
  platform: string
}

export async function resolveUploadedBuild(params: {
  appPath: string
  appType: string
  issuerId: string
  apiKeyId: string
  apiPrivateKey: string
}): Promise<ResolvedUploadedBuild> {
  const app = await extractAppMetadata(params.appPath)
  const token = () =>
    generateJwt(params.issuerId, params.apiKeyId, params.apiPrivateKey)
  const platform = buildPlatform(params.appType)
  const appId = await lookupAppId(app.bundleId, token)
  const buildId = await lookupBuildIdWithRetry(
    {
      appId,
      buildNumber: app.buildNumber,
      platform,
      token
    },
    20,
    30000,
    attempt => {
      warning(
        `Build ${app.buildNumber} not yet visible in App Store Connect (attempt ${
          attempt + 1
        }/20). Retrying in ${Math.round(30000 / 1000)}s`
      )
    }
  )

  return {appId, buildId, app, token, platform}
}
