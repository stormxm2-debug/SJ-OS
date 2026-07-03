/**
 * Shared contract for the AI Proxy status bridge.
 *
 * The Electron main process probes the LOCAL sj-ai-proxy status endpoint and
 * returns this sanitized shape to the renderer over IPC. It NEVER contains an
 * OpenAI API key — only the proxy's own readiness flags. Both the main handler
 * and the preload bridge type against this so they stay in sync.
 */
export interface AiProxyBridgeStatus {
  /** True when a local proxy answered GET /ai/status with valid JSON. */
  reachable: boolean
  /** The proxy base URL that answered (e.g. http://127.0.0.1:8787), when reachable. */
  selectedProxyUrl?: string
  enabled?: boolean
  apiKeyConfigured?: boolean
  ready?: boolean
  model?: string
  sttModel?: string
  maxAudioSeconds?: number
  /** Sanitized status message from the proxy, or a local diagnostic message. */
  message?: string
  /** Low-level connection error detail when unreachable. */
  lastError?: string
  /** ISO timestamp of the probe (main-process clock). */
  checkedAt: string
}
