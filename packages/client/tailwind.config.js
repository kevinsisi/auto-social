/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        asphalt: '#171717',
        paper: '#f5f0e8',
        signal: '#ff6b35'
      },
      fontFamily: {
        display: ['Noto Sans TC', 'ui-sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
