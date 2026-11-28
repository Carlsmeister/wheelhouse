/**
 * Policy for application pages, shared by the backend and Vite page hosts.
 * @param {number} port Backend WebSocket port.
 * @param {boolean} [development=false] Allow Vite's inline preamble and loopback HMR.
 * @returns {string}
 */
export function applicationCsp(port, development = false) {
  return [
    "default-src 'self'",
    development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    development
      ? "connect-src 'self' ws://127.0.0.1:* ws://localhost:*"
      : `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    'frame-src http: https:',
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}
