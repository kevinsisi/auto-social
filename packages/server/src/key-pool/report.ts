export type KeyReportStatus = 'success' | 'cooldown' | 'auth_failure'

export async function reportToManager(keySuffix: string, status: KeyReportStatus, baseUrl = process.env.KEY_MANAGER_URL) {
  if (!baseUrl) return { reported: false, reason: 'KEY_MANAGER_URL 未設定。' }

  const url = new URL('/api/keys/report', baseUrl)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keySuffix, status }),
    signal: AbortSignal.timeout(10_000)
  })

  return { reported: response.ok, status: response.status }
}
