import { describe, expect, it } from 'vitest'
import { extractThreadsLinks } from '../src/sources/threads-search.js'

describe('extractThreadsLinks', () => {
  it('extracts Threads URLs from Google result hrefs', () => {
    const html = '<a href="/url?q=https://www.threads.net/@someone/post/abc&sa=U">result</a><a href="https://threads.net/@other/post/def">direct</a>'

    const results = extractThreadsLinks(html, '可麗餅')

    expect(results.map((item) => item.url)).toEqual([
      'https://www.threads.net/@someone/post/abc',
      'https://threads.net/@other/post/def'
    ])
  })
})
