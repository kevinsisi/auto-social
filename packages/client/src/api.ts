import type { CandidateStatus, KeyStatus, PatrolCard, PatrolCardDetail } from './types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const text = await response.text()
  const data = parseResponse(text)
  if (!response.ok) {
    throw new Error(getErrorMessage(data, response.status))
  }
  return data as T
}

function parseResponse(text: string): unknown {
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { error: `API 回傳不是 JSON，可能打到舊路由或 HTML 錯誤頁：${text.slice(0, 80)}` }
  }
}

function getErrorMessage(data: unknown, status: number) {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') return data.error
  return `操作失敗，HTTP ${status}`
}

export const api = {
  async listCards() {
    return request<{ cards: PatrolCard[] }>('/api/cards')
  },
  async createCard(keyword: string) {
    return request<{ card: PatrolCard }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ keyword })
    })
  },
  async getCard(cardId: string) {
    return request<{ card: PatrolCardDetail }>(`/api/cards/${cardId}`)
  },
  async addCandidate(cardId: string, url: string, title: string, excerpt: string) {
    return request('/api/cards/' + cardId + '/candidates', {
      method: 'POST',
      body: JSON.stringify({ url, title, excerpt })
    })
  },
  async startBrowserRun(cardId: string) {
    return request<{ run: { searchUrl: string; message: string } }>(`/api/cards/${cardId}/browser-run`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async scanThreads(cardId: string) {
    return request<{ run: { message: string; inserted: unknown[] } }>(`/api/cards/${cardId}/scan-threads`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async updateCandidateStatus(candidateId: string, status: CandidateStatus) {
    return request(`/api/candidates/${candidateId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    })
  },
  async getKeyStatus() {
    return request<{ keys: KeyStatus[] }>('/api/admin/keys/status')
  },
  async importKeys(text: string) {
    return request<{ parsed: number; inserted: number; duplicate: number }>('/api/admin/keys/batch-import', {
      method: 'POST',
      body: JSON.stringify({ text })
    })
  },
  async syncKeys() {
    return request<{ synced: boolean; imported: number; warning: string | null }>('/api/admin/keys/sync', {
      method: 'POST',
      body: JSON.stringify({})
    })
  }
}
