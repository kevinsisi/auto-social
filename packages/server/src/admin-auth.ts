import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

const ADMIN_COOKIE = 'auto_social_admin'
const ADMIN_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export function getAdminSessionStatus(req: Request) {
  return { configured: Boolean(getAdminToken()), authenticated: isAdminAuthenticated(req) }
}

export function loginAdmin(req: Request, res: Response, token: string) {
  const configuredToken = getAdminToken()
  if (!configuredToken) throw new Error('ADMIN_TOKEN 未設定。')
  if (!safeEqual(token, configuredToken)) return res.status(401).json({ error: 'ADMIN_TOKEN 不正確。' })
  setAdminCookie(res)
  return res.json({ session: { configured: true, authenticated: true } })
}

export function logoutAdmin(res: Response) {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0`)
  return res.json({ session: { configured: Boolean(getAdminToken()), authenticated: false } })
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = getAdminToken()
  if (token) {
    if (isAdminAuthenticated(req)) return next()
    return res.status(401).json({ error: '需要 ADMIN_TOKEN 授權。' })
  }

  if (isLoopback(req.ip ?? '') || isLoopback(req.socket.remoteAddress ?? '')) return next()
  return res.status(403).json({ error: '未設定 ADMIN_TOKEN 時，管理 API 僅允許本機存取。' })
}

function isAdminAuthenticated(req: Request) {
  const token = getAdminToken()
  if (!token) return isLoopback(req.ip ?? '') || isLoopback(req.socket.remoteAddress ?? '')

  const header = req.get('authorization') ?? ''
  if (header === `Bearer ${token}`) return true

  const cookie = parseCookies(req.get('cookie') ?? '')[ADMIN_COOKIE]
  return Boolean(cookie && safeEqual(cookie, signAdminCookie(token)))
}

function setAdminCookie(res: Response) {
  const token = getAdminToken()
  if (!token) throw new Error('ADMIN_TOKEN 未設定。')
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE}=${signAdminCookie(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}${secure}`)
}

function signAdminCookie(token: string) {
  return createHmac('sha256', token).update('auto-social-admin-session-v1').digest('hex')
}

function getAdminToken() {
  return process.env.ADMIN_TOKEN?.trim() ?? ''
}

function parseCookies(header: string) {
  const cookies: Record<string, string> = {}
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (!key) continue
    cookies[key] = decodeURIComponent(value.join('='))
  }
  return cookies
}

function safeEqual(a: string, b: string) {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer)
}

function isLoopback(value: string) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}
