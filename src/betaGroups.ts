import {info, warning} from '@actions/core'
import {readFile} from 'fs/promises'
import {fetchJson, type TokenSource} from './utils/http'
import type {ResolvedUploadedBuild} from './utils/resolve-uploaded-build'

type BetaGroup = {
  id: string
  name: string
  isInternalGroup: boolean
  hasAccessToAllBuilds: boolean
}

export type GroupsOutcome = {
  status: 'skipped' | 'assigned'
  summary: string
}

/** Parse comma- and/or newline-separated group names from the `groups` input. */
export function parseGroupsInput(value: string): string[] {
  return uniqueNames(
    value
      .split(/[,\n\r]+/)
      .map(part => part.trim())
      .filter(part => part.length > 0)
  )
}

/** Parse a groups file: one name per line, `#` comments and blanks ignored. */
export function parseGroupsFileContents(contents: string): string[] {
  const names: string[] = []
  for (const rawLine of contents.split(/\r?\n/)) {
    const withoutComment = rawLine.replace(/#.*$/, '')
    const name = withoutComment.trim()
    if (name.length > 0) {
      names.push(name)
    }
  }
  return uniqueNames(names)
}

/**
 * Resolve the group name list from exactly one of `groups` or `groups-file`.
 * Returns an empty array when neither is set (caller should skip assignment).
 */
export async function resolveGroupNames(params: {
  groups: string
  groupsFile: string
}): Promise<string[]> {
  const hasGroups = params.groups.trim() !== ''
  const hasFile = params.groupsFile.trim() !== ''

  if (hasGroups && hasFile) {
    throw new Error(
      'Inputs "groups" and "groups-file" are mutually exclusive. Provide exactly one.'
    )
  }

  if (!hasGroups && !hasFile) {
    return []
  }

  if (hasGroups) {
    const names = parseGroupsInput(params.groups)
    if (names.length === 0) {
      throw new Error(
        'Input "groups" was provided but contained no group names after parsing.'
      )
    }
    return names
  }

  const path = params.groupsFile.trim()
  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch (error: unknown) {
    throw new Error(
      `Failed to read groups-file "${path}": ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }

  const names = parseGroupsFileContents(contents)
  if (names.length === 0) {
    throw new Error(
      `groups-file "${path}" did not contain any group names (after removing comments and blank lines).`
    )
  }
  return names
}

export async function assignBuildToGroups(
  groupNames: string[],
  resolved: ResolvedUploadedBuild
): Promise<GroupsOutcome> {
  if (groupNames.length === 0) {
    return {
      status: 'skipped',
      summary: 'TestFlight group assignment skipped: no groups requested.'
    }
  }

  const groups = await listBetaGroups(resolved.appId, resolved.token)
  const matched = matchGroupsByName(groupNames, groups)
  const linked: string[] = []
  const skippedAllBuilds: string[] = []
  let linkedExternal = false

  for (const group of matched) {
    if (group.hasAccessToAllBuilds) {
      info(
        `Beta group "${group.name}" already has access to all builds; skipping explicit link.`
      )
      skippedAllBuilds.push(group.name)
      if (!group.isInternalGroup) {
        linkedExternal = true
      }
      continue
    }

    await addBuildToBetaGroup(group.id, resolved.buildId, resolved.token)
    info(
      `Added build ${resolved.buildId} to TestFlight beta group "${group.name}".`
    )
    linked.push(group.name)
    if (!group.isInternalGroup) {
      linkedExternal = true
    }
  }

  let reviewNote = ''
  if (linkedExternal) {
    reviewNote = await maybeSubmitBetaAppReview(
      resolved.buildId,
      resolved.token
    )
  }

  const parts: string[] = []
  if (linked.length > 0) {
    parts.push(`linked to ${linked.map(quote).join(', ')}`)
  }
  if (skippedAllBuilds.length > 0) {
    parts.push(
      `already covered by ${skippedAllBuilds.map(quote).join(', ')} (hasAccessToAllBuilds)`
    )
  }
  if (reviewNote) {
    parts.push(reviewNote)
  }

  return {
    status: 'assigned',
    summary: `TestFlight group assignment for build ${resolved.buildId}: ${parts.join('; ')}.`
  }
}

async function listBetaGroups(
  appId: string,
  token: TokenSource
): Promise<BetaGroup[]> {
  const response = await fetchJson<{
    data?: Array<{
      id?: string
      attributes?: {
        name?: string
        isInternalGroup?: boolean
        hasAccessToAllBuilds?: boolean
      }
    }>
  }>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/list-beta-groups
    `/betaGroups?filter[app]=${encodeURIComponent(appId)}&fields[betaGroups]=name,isInternalGroup,hasAccessToAllBuilds&limit=200`,
    token,
    'Failed to list TestFlight beta groups.'
  )

  return (response.data ?? [])
    .map(item => {
      const id = item.id?.trim()
      const name = item.attributes?.name?.trim()
      if (!id || !name) {
        return undefined
      }
      return {
        id,
        name,
        isInternalGroup: Boolean(item.attributes?.isInternalGroup),
        hasAccessToAllBuilds: Boolean(item.attributes?.hasAccessToAllBuilds)
      }
    })
    .filter((group): group is BetaGroup => group !== undefined)
}

function matchGroupsByName(
  requestedNames: string[],
  available: BetaGroup[]
): BetaGroup[] {
  const availableNames = available.map(group => group.name).sort()
  const matched: BetaGroup[] = []

  for (const requested of requestedNames) {
    const hits = available.filter(group => group.name === requested)
    if (hits.length === 0) {
      throw new Error(
        `No TestFlight beta group named "${requested}". Available groups: ${
          availableNames.length > 0
            ? availableNames.map(quote).join(', ')
            : '(none)'
        }.`
      )
    }
    if (hits.length > 1) {
      throw new Error(
        `Multiple TestFlight beta groups are named "${requested}" (${hits
          .map(group => group.id)
          .join(
            ', '
          )}). Rename groups in App Store Connect so names are unique.`
      )
    }
    matched.push(hits[0])
  }

  return matched
}

async function addBuildToBetaGroup(
  groupId: string,
  buildId: string,
  token: TokenSource
): Promise<void> {
  try {
    await fetchJson(
      // Docs: https://developer.apple.com/documentation/appstoreconnectapi/add-builds-to-a-beta-group
      `/betaGroups/${groupId}/relationships/builds`,
      token,
      `Failed to add build ${buildId} to beta group ${groupId}.`,
      'POST',
      {
        data: [
          {
            type: 'builds',
            id: buildId
          }
        ]
      }
    )
  } catch (error: unknown) {
    if (isAlreadyLinkedError(error)) {
      warning(
        `Build ${buildId} was already linked to beta group ${groupId}; continuing.`
      )
      return
    }
    throw error
  }
}

async function maybeSubmitBetaAppReview(
  buildId: string,
  token: TokenSource
): Promise<string> {
  const externalState = await fetchExternalBuildState(buildId, token)
  if (externalState !== 'READY_FOR_BETA_SUBMISSION') {
    info(
      `Skipping beta app review submission for build ${buildId} (externalBuildState=${
        externalState ?? 'unknown'
      }).`
    )
    return `beta review not submitted (externalBuildState=${externalState ?? 'unknown'})`
  }

  try {
    await fetchJson(
      // Docs: https://developer.apple.com/documentation/appstoreconnectapi/submit-an-app-for-beta-review
      '/betaAppReviewSubmissions',
      token,
      `Failed to submit build ${buildId} for TestFlight beta app review.`,
      'POST',
      {
        data: {
          type: 'betaAppReviewSubmissions',
          relationships: {
            build: {
              data: {
                type: 'builds',
                id: buildId
              }
            }
          }
        }
      }
    )
    info(`Submitted build ${buildId} for TestFlight beta app review.`)
    return 'submitted for beta app review'
  } catch (error: unknown) {
    if (isAlreadySubmittedError(error)) {
      warning(
        `Build ${buildId} already has a beta app review submission; continuing.`
      )
      return 'beta app review already submitted'
    }
    throw error
  }
}

async function fetchExternalBuildState(
  buildId: string,
  token: TokenSource
): Promise<string | undefined> {
  const response = await fetchJson<{
    data?: {attributes?: {externalBuildState?: string}}
  }>(
    // Docs: https://developer.apple.com/documentation/appstoreconnectapi/read-the-build-beta-details-information-of-a-build
    `/builds/${buildId}/buildBetaDetail`,
    token,
    `Failed to read build beta detail for build ${buildId}.`
  )

  const state = response.data?.attributes?.externalBuildState?.trim()
  return state || undefined
}

function isAlreadyLinkedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    /\(409\)/.test(error.message) ||
    /ENTITY_ERROR\.RELATIONSHIP\.INVALID/i.test(error.message) ||
    /already.*(added|associated|linked)/i.test(error.message)
  )
}

function isAlreadySubmittedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return (
    /\(409\)/.test(error.message) ||
    /STATE_ERROR/i.test(error.message) ||
    /already.*(submitted|exists)/i.test(error.message)
  )
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}

function quote(name: string): string {
  return `"${name}"`
}
