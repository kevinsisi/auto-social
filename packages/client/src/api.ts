import type { CandidateStatus, KeyStatus, PatrolCard, PatrolCardDetail } from './types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error ?? '操作失敗，這很難評。')
  }
  return data as T
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
