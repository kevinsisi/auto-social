import { describe, expect, it } from 'vitest'
import { fetchThreadsBraveSearchOutcome } from '../src/sources/threads-brave-search.js'

describe('fetchThreadsBraveSearchOutcome', () => {
  it('maps Brave web results into Threads search candidates', async () => {
    const outcome = await fetchThreadsBraveSearchOutcome('Urus', 10, {
      apiKey: 'test-key',
      fetchBrave: async (keyword, limit, apiKey) => {
        expect(keyword).toBe('Urus')
        expect(limit).toBe(10)
        expect(apiKey).toBe('test-key')
        return {
          web: {
            results: [
              {
                url: 'https://www.threads.net/@cars/post/BRAVE1',
                title: '<strong>Urus</strong> 車主討論',
                description: 'Threads 上大家在聊 Urus 保養心得。'
              }
            ]
          }
        }
      }
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.providerUsed).toBe('brave')
    expect(outcome.candidates).toEqual([
      {
        source: 'threads_search',
        url: 'https://www.threads.net/@cars/post/BRAVE1',
        title: 'Urus 車主討論',
        excerpt: 'Threads 上大家在聊 Urus 保養心得。'
      }
    ])
  })

  it('silently skips Brave when the API key is missing', async () => {
    let called = false
    const outcome = await fetchThreadsBraveSearchOutcome('Urus', 10, {
      apiKey: '',
      fetchBrave: async () => {
        called = true
        return { web: { results: [] } }
      }
    })

    expect(called).toBe(false)
    expect(outcome.status).toBe('no_results')
    expect(outcome.blockedProviders).toEqual([])
  })

  it('filters non-post and keyword-irrelevant Brave results', async () => {
    const outcome = await fetchThreadsBraveSearchOutcome('Urus', 10, {
      apiKey: 'test-key',
      fetchBrave: async () => ({
        web: {
          results: [
            { url: 'https://www.threads.net/search?q=Urus', title: 'Urus search', description: 'Threads search page' },
            { url: 'https://www.threads.net/@music/post/NOPE', title: '播放清單', description: '今天大家在聽什麼' },
            { url: 'https://www.threads.net/@cars/post/OK', title: 'Urus 交車心得', description: '車主分享日常用車。' }
          ]
        }
      })
    })

    expect(outcome.status).toBe('ok')
    expect(outcome.candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/OK'])
  })

  it('reports Brave as blocked when the API request fails', async () => {
    const outcome = await fetchThreadsBraveSearchOutcome('Urus', 10, {
      apiKey: 'test-key',
      fetchBrave: async () => { throw new Error('rate limited') }
    })

    expect(outcome.status).toBe('blocked')
    expect(outcome.providerUsed).toBeNull()
    expect(outcome.blockedProviders).toEqual(['brave'])
  })
})
