import { extractThreadsLinks, fetchThreadsFallbackOutcome, type ThreadsFallbackOutcome, type ThreadsFallbackProvider, type ThreadsSearchCandidate } from './threads-fallback-search.js'

export type { ThreadsSearchCandidate, ThreadsFallbackOutcome, ThreadsFallbackProvider }
export { extractThreadsLinks }

const MAX_RESULTS = 10

export async function fetchThreadsSearchCandidates(keyword: string, limit = MAX_RESULTS): Promise<ThreadsSearchCandidate[]> {
  const outcome = await fetchThreadsFallbackOutcome(keyword, { limit })
  return outcome.candidates
}

export async function fetchThreadsSearchOutcome(keyword: string, limit = MAX_RESULTS): Promise<ThreadsFallbackOutcome> {
  return fetchThreadsFallbackOutcome(keyword, { limit })
}
