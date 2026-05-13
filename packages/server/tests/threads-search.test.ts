import { describe, expect, it } from 'vitest'
import { extractThreadsLinks } from '../src/sources/threads-search.js'
import { cleanThreadsExcerptForDisplay, isKeywordRelevant, isTaiwanRelevant } from '../src/threads-bot/search.js'

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

describe('isTaiwanRelevant', () => {
  it('keeps a Chinese-dominant post for a Chinese query', () => {
    const text = '今天去夜市吃了滷肉飯，老闆真的很有人情味'
    expect(isTaiwanRelevant(text, '夜市')).toBe(true)
  })

  it('drops an English-dominant post for a Chinese query', () => {
    const text = 'AI Tools List For Ideas Research Image Generation Content Writing Website Building Video Generator Editor Music Generation'
    expect(isTaiwanRelevant(text, 'AI')).toBe(false)
  })

  it('drops an English-dominant post even for an English query (Taiwan-first)', () => {
    const text = 'Building a side project with React and TypeScript has been a blast'
    expect(isTaiwanRelevant(text, 'side project')).toBe(false)
  })

  it('drops a Japanese-dominant post', () => {
    const text = 'お疲れさまです。今日は東京タワーに行きました。本当にきれいでした。'
    expect(isTaiwanRelevant(text, '東京')).toBe(false)
  })

  it('drops a Korean-dominant post', () => {
    const text = '오늘은 정말 좋은 하루였습니다. 친구들과 함께 맛있는 음식을 먹었어요.'
    expect(isTaiwanRelevant(text, '韓國')).toBe(false)
  })

  it('keeps mixed Chinese + English when Chinese is substantial', () => {
    const text = '推薦這個 AI 工具，整理筆記超快，台灣朋友可以試試'
    expect(isTaiwanRelevant(text, 'AI 工具')).toBe(true)
  })
})

describe('isKeywordRelevant', () => {
  it('keeps CJK posts containing the exact keyword', () => {
    expect(isKeywordRelevant('今天來聊 Urus 改裝跟養車成本', 'Urus')).toBe(true)
  })

  it('drops posts that do not mention the requested keyword', () => {
    expect(isKeywordRelevant('Mastaruu.. 🤍🙂', 'Urus')).toBe(false)
  })

  it('matches latin keyword case-insensitively on word boundaries', () => {
    expect(isKeywordRelevant('最近很多人在討論 urus 的外觀', 'Urus')).toBe(true)
  })

  it('keeps CJK phrase matches directly', () => {
    expect(isKeywordRelevant('我的日常生活真的離不開咖啡', '日常生活')).toBe(true)
  })
})
