import { describe, expect, it } from 'vitest'
import { fetchThreadsGoogleCseSearchOutcome } from '../src/sources/threads-google-cse-search.js'

describe('fetchThreadsGoogleCseSearchOutcome', () => {
  const config = { apiKey: 'google-key', cx: 'search-engine-id' }

  it('maps Google Programmable Search items into Threads search candidates', async () => {
    const outcome = await fetchThreadsGoogleCseSearchOutcome('Urus', 10, {
      config,
      fetchGoogleCse: async (keyword, limit, usedConfig) => {
        expect(keyword).toBe('Urus')
        expect(limit).toBe(10)
        expect(usedConfig).toEqual(config)
        return {
          items: [
            {
              link: 'https://www.threads.net/@cars/post/GOOGLECSE1',
              title: 'Urus 車主心得',
              snippet: 'Threads 上大家在聊 Urus 保養成本。'
            }
          ]
        }
      }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('google_cse')
    expect(outcome.candidates).toEqual([
      {
        source: 'threads_search',
        url: 'https://www.threads.net/@cars/post/GOOGLECSE1',
        title: 'Urus 車主心得',
        excerpt: 'Threads 上大家在聊 Urus 保養成本。'
      }
    ])
  })

  it('skips Google Programmable Search when config is incomplete', async () => {
    let called = false
    const outcome = await fetchThreadsGoogleCseSearchOutcome('Urus', 10, {
      config: null,
      fetchGoogleCse: async () => {
        called = true
        return { items: [] }
      }
    })

    expect(called).toBe(false)
    expect(outcome.status).toBe('no_results')
    expect(outcome.blockedProviders).toEqual([])
  })

  it('filters non-post and keyword-irrelevant Google results', async () => {
    const outcome = await fetchThreadsGoogleCseSearchOutcome('Urus', 10, {
      config,
      fetchGoogleCse: async () => ({
        items: [
          { link: 'https://www.threads.net/search?q=Urus', title: 'Urus search', snippet: 'Threads search page' },
          { link: 'https://www.threads.net/@music/post/NOPE', title: '播放清單', snippet: '今天大家在聽什麼' },
          { link: 'https://www.threads.net/@cars/post/OK', title: 'Urus 交車心得', snippet: '車主分享日常用車。' }
        ]
      })
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/OK'])
  })

  it('reports Google Programmable Search as blocked when the API request fails', async () => {
    const outcome = await fetchThreadsGoogleCseSearchOutcome('Urus', 10, {
      config,
      fetchGoogleCse: async () => { throw new Error('quota exceeded') }
    })

    expect(outcome.status).toBe('blocked')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual(['google_cse'])
  })
})
