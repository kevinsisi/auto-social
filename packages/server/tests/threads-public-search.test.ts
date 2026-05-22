import { describe, expect, it } from 'vitest'
import { isThreadsPublicSearchBlock, normaliseThreadsPublicResults } from '../src/sources/threads-public-search.js'

describe('normaliseThreadsPublicResults', () => {
  it('keeps keyword-matching public Threads search posts', () => {
    const candidates = normaliseThreadsPublicResults([
      {
        url: 'https://www.threads.com/@cars/post/abc',
        title: 'cars',
        excerpt: 'cars 2天 Lamborghini Urus SE 車主分享 翻譯 150 1 4'
      }
    ], 'Urus')

    expect(candidates).toEqual([
      {
        url: 'https://www.threads.com/@cars/post/abc',
        title: 'cars',
        excerpt: 'cars 2天 Lamborghini Urus SE 車主分享 翻譯 150 1 4',
        source: 'threads_search'
      }
    ])
  })

  it('drops login shell and unrelated public Threads results', () => {
    const candidates = normaliseThreadsPublicResults([
      { url: 'https://www.threads.com/@login/post/a', title: '加入 Threads', excerpt: '登入或註冊 Threads 使用 Instagram 帳號繼續' },
      { url: 'https://www.threads.com/@music/post/b', title: '播放清單', excerpt: '最近大家推薦音樂' },
      { url: 'https://www.threads.com/@cars/post/c', title: '法拉利交車', excerpt: '車主分享法拉利交車心得' }
    ], '法拉利')

    expect(candidates.map((candidate) => candidate.url)).toEqual(['https://www.threads.com/@cars/post/c'])
  })

  it('preserves public Threads media and engagement for downstream display and image analysis', () => {
    const image = 'https://scontent.cdninstagram.com/v/t51.82787-15/photo.webp'
    const poster = 'https://scontent.cdninstagram.com/v/t51.82787-15/poster.webp'
    const candidates = normaliseThreadsPublicResults([
      {
        url: 'https://www.threads.com/@cars/post/media1',
        title: 'cars',
        excerpt: 'Lamborghini Urus SE 實拍分享',
        author: '@cars',
        postedAt: '2026-05-22T08:00:00.000Z',
        likes: 12,
        replyCount: 3,
        reposts: 2,
        shares: 1,
        images: [image],
        videos: [{ src: poster, poster }]
      }
    ], 'Urus')

    expect(candidates[0]).toMatchObject({
      url: 'https://www.threads.com/@cars/post/media1',
      source: 'threads_search',
      author: '@cars',
      postedAt: '2026-05-22T08:00:00.000Z',
      likes: 12,
      replyCount: 3,
      reposts: 2,
      shares: 1,
      images: [image],
      videos: [{ src: poster, poster }]
    })
  })
})

describe('isThreadsPublicSearchBlock', () => {
  it('flags challenge and checkpoint pages', () => {
    expect(isThreadsPublicSearchBlock('https://www.threads.com/challenge', 'Threads', 'Please complete this captcha')).toBe(true)
    expect(isThreadsPublicSearchBlock('https://www.threads.com/search?q=Urus', '搜尋 • Threads', '登入以取得更多有關此主題的串文')).toBe(false)
  })
})
