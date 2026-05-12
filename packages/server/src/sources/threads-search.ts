type ThreadsSearchCandidate = {
  url: string
  title: string
  excerpt: string
  source: 'threads_search'
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_RESULTS = 10

export async function fetchThreadsSearchCandidates(keyword: string, limit = MAX_RESULTS): Promise<ThreadsSearchCandidate[]> {
  const query = `${keyword.trim()} site:threads.net`
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=zh-TW`
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`Google Threads 搜尋失敗：HTTP ${response.status}`)

  const html = await response.text()
  return extractThreadsLinks(html, keyword).slice(0, limit)
}

export function extractThreadsLinks(html: string, keyword: string): ThreadsSearchCandidate[] {
  const links = new Map<string, ThreadsSearchCandidate>()
  const hrefPattern = /href="(?:\/url\?q=)?(https:\/\/(?:www\.)?threads\.net\/[^"&]+)[^">]*"/g
  for (const match of html.matchAll(hrefPattern)) {
    const rawUrl = match[1]
    if (!rawUrl) continue
    const url = decodeURIComponent(rawUrl)
    if (url.includes('/search?') || url.includes('/privacy') || url.includes('/login')) continue
    links.set(url, {
      url,
      title: `Threads 搜尋結果：${keyword}`,
      excerpt: 'Google 找到的 Threads 連結；開頁確認原文後再互動。',
      source: 'threads_search'
    })
  }
  return [...links.values()]
}
