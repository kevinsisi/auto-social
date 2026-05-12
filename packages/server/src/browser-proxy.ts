import { createProxyMiddleware } from 'http-proxy-middleware'

export const browserProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:6080',
  changeOrigin: true,
  ws: true,
  pathRewrite: { '^/browser': '' }
})
