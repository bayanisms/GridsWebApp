import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs work both at a GitHub Pages project URL
  // (https://<owner>.github.io/<repo>/) and when embedded from Wix.
  base: './',
  plugins: [react()],
})
