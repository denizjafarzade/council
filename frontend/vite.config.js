import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Lets the UI import ../mocks/council_run.json.
    fs: { allow: ['..'] },
    proxy: { '/council': 'http://localhost:8000', '/health': 'http://localhost:8000' },
  },
})
