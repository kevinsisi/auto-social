import { describe, expect, it } from 'vitest'
import { extractThreadsLinks } from '../src/sources/threads-search.js'
import { cleanThreadsExcerptForDisplay } from '../src/threads-bot/search.js'

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

describe('cleanThreadsExcerptForDisplay', () => {
  it('removes Threads engagement labels embedded in visible text', () => {
    const text = 'ravens_ash 已 如果你喜歡狗➡️來看疑犯追蹤 留言64轉發 分享949'

    expect(cleanThreadsExcerptForDisplay(text)).toBe('ravens_ash 已 如果你喜歡狗➡️來看疑犯追蹤')
  })

  it('removes split share labels and count-before-label variants', () => {
    const text = '貼文內容 64留言 12轉發 分 享949 1.2K讚'

    expect(cleanThreadsExcerptForDisplay(text)).toBe('貼文內容')
  })
})
