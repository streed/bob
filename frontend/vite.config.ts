import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 47285,
    proxy: {
      '/api': 'http://localhost:43829'
    }
  }
})