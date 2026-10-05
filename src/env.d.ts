/// <reference types="vite/client" />

import type { FbApi } from '../core/api.ts'

/** What electron/preload.ts exposes; missing when the interface runs outside Electron (tests). */
declare global {
  interface Window {
    fb?: FbApi
  }
}
