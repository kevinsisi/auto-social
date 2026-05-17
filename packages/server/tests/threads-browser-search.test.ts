import { describe, expect, it } from 'vitest'
import { isDuckDuckGoBrowserBlock, normaliseBrowserResults } from '../src/sources/threads-browser-search.js'

describe('normaliseBrowserResults', () => {
  it('keeps keyword-matching Threads post results from browser search', () => {
    const candidates = normaliseBrowserResults([
      { url: 'https://www.threads.net/@cars/post/abc', title: 'Urus 車主討論', excerpt: '大家在 Threads 分享 Urus 保養心得' }
    ], 'Urus')

    expect(candidates).toEqual([
      { url: 'https://www.threads.net/@cars/post/abc', title: 'Urus 車主討論', excerpt: '大家在 Threads 分享 Urus 保養心得', source: 'threads_search' }
    ])
  })

  it('drops Threads landing pages and unrelated browser results', () => {
    const candidates = normaliseBrowserResults([
      { url: 'https://www.threads.net/@login/post/a', title: '加入 Threads', excerpt: '使用你的 Instagram 登入' },
      { url: 'https://www.threads.net/@music/post/b', title: '播放清單', excerpt: '最近大家推薦音樂' },
      { url: 'https://www.threads.net/@cars/post/c', title: '法拉利交車', excerpt: '車主分享法拉利交車心得' }
    ], '法拉利')

    expect(candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.net/@cars/post/c'])
  })
})

describe('isDuckDuckGoBrowserBlock', () => {
  it('flags DuckDuckGo static 418 protection pages', () => {
    expect(isDuckDuckGoBrowserBlock(
      'https://duckduckgo.com/static-pages/418.html?bno=84f2',
      'DuckDuckGo - Protection. Privacy. Peace of mind.',
      'email us error getting results'
    )).toBe(true)
  })
})
