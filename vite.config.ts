import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { applicationCsp } from './shared/content-security.js'

const target = 'http://127.0.0.1:4318'

export default defineConfig({
  plugins: [react()],
  server: {
    headers: { 'Content-Security-Policy': applicationCsp(4318, true) },
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true },
    },
  },
  preview: {
    headers: { 'Content-Security-Policy': applicationCsp(4318) },
  },
})
