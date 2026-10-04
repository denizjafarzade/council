import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Lets the UI import ../mocks/council_run.json.
    fs: { allow: ['..'] },
    // '/council' also covers '/councils'.
    proxy: Object.fromEntries(
      ['/council', '/library', '/health', '/news', '/portfolio'].map((path) => [path, 'http://localhost:8000']),
    ),
  },
})
