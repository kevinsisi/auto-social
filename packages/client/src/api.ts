import type { AdminSession, CandidateStatus, FeedbackDecision, KeyStatus, KeywordObservation, PatrolCard, PatrolCardDetail, PostDraft, QueueSnapshot, RadarTrend, SchedulerStatus, ThreadsLoginJob, ThreadsSessionStatus, ThreadsThrottleSnapshot } from './types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  headers.set('Content-Type', 'application/json')
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers
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
  async getAdminSession() {
    return request<{ session: AdminSession }>('/api/admin/session')
  },
  async loginAdmin(token: string) {
    return request<{ session: AdminSession }>('/api/admin/session/login', {
      method: 'POST',
      body: JSON.stringify({ token })
    })
  },
  async logoutAdmin() {
    return request<{ session: AdminSession }>('/api/admin/session/logout', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
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
  async deleteCard(cardId: string) {
    const response = await fetch(`/api/cards/${cardId}`, { method: 'DELETE', credentials: 'same-origin' })
    if (!response.ok && response.status !== 204) {
      const text = await response.text()
      throw new Error(text || `刪除失敗，HTTP ${response.status}`)
    }
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
  async getRadarTrends() {
    return request<{ radar: RadarTrend }>('/api/radar/trends')
  },
  async runRadarScan() {
    return request<{ radar: RadarTrend }>('/api/admin/scan/run-now', {
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
  },
  async resetKeyCooldowns() {
    return request<{ reset: number }>('/api/admin/keys/reset-cooldowns', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async getThreadsSessionStatus() {
    return request<{ session: ThreadsSessionStatus }>('/api/threads/session/status')
  },
  async getThreadsThrottle() {
    return request<{ throttle: ThreadsThrottleSnapshot }>('/api/threads/throttle')
  },
  async updateThreadsDailyLimits(limits: Partial<ThreadsThrottleSnapshot['dailyLimits']>) {
    return request<{ throttle: ThreadsThrottleSnapshot }>('/api/admin/threads/daily-limits', {
      method: 'PUT',
      body: JSON.stringify(limits)
    })
  },
  async resetThreadsSearchQuotaToday() {
    return request<{ reset: number; throttle: ThreadsThrottleSnapshot }>('/api/admin/threads/quotas/search/reset-today', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async startThreadsSession() {
    return request<{ login: ThreadsLoginJob; message: string }>('/api/threads/session/start', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async clickThreadsLogin(jobId: string, x: number, y: number) {
    return request<{ login: ThreadsLoginJob }>(`/api/threads/session/login/${jobId}/click`, {
      method: 'POST',
      body: JSON.stringify({ x, y })
    })
  },
  async typeThreadsLogin(jobId: string, text: string) {
    return request<{ login: ThreadsLoginJob }>(`/api/threads/session/login/${jobId}/type`, {
      method: 'POST',
      body: JSON.stringify({ text })
    })
  },
  async pressThreadsLogin(jobId: string, key: 'Enter' | 'Tab' | 'Escape' | 'Backspace') {
    return request<{ login: ThreadsLoginJob }>(`/api/threads/session/login/${jobId}/press`, {
      method: 'POST',
      body: JSON.stringify({ key })
    })
  },
  async finishThreadsLogin(jobId: string) {
    return request<{ session: ThreadsSessionStatus }>(`/api/threads/session/login/${jobId}/finish`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async cancelThreadsLogin(jobId: string) {
    return request<{ session: ThreadsSessionStatus }>(`/api/threads/session/login/${jobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  getThreadsLoginScreenshotUrl(jobId: string) {
    return `/api/threads/session/login/${jobId}/screenshot?t=${Date.now()}`
  },
  async clearThreadsSession() {
    return request<{ session: ThreadsSessionStatus }>('/api/threads/session/clear', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async importThreadsSession(storageStateJson: string) {
    return request<{ session: ThreadsSessionStatus }>('/api/threads/session/import', {
      method: 'POST',
      body: JSON.stringify({ storageStateJson })
    })
  },
  async importThreadsSessionFromFile() {
    return request<{ session: ThreadsSessionStatus; importedFrom: string }>('/api/threads/session/import-from-file', {
      method: 'POST',
      body: JSON.stringify({})
    })
  },
  async getKeywordObservation(cardId: string) {
    return request<{ observation: KeywordObservation }>(`/api/keywords/${cardId}/observe`)
  },
  async submitVoiceFeedback(input: { draftId: string; variantIdx: number; decision: FeedbackDecision; comment?: string }) {
    return request<{ feedback: { id: string; createdAt: string } }>('/api/voice/feedback', {
      method: 'POST',
      body: JSON.stringify(input)
    })
  },
  async getAiStatus() {
    return request<{ queue: QueueSnapshot }>('/api/ai/status')
  },
  async getSchedulerStatus() {
    return request<{ scheduler: SchedulerStatus }>('/api/scheduler/status')
  },
  async listPostDrafts() {
    return request<{ drafts: PostDraft[] }>('/api/post-drafts')
  },
  async runComposePost() {
    return request<{ queued: { taskId: string | null; payload: { seedKeyword: string } } }>('/api/admin/post-drafts/run-now', {
      method: 'POST',
      body: JSON.stringify({})
    })
  }
}
