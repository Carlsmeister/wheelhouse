import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const root = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(root, '../../..')
const { createServer } = await import(pathToFileURL(path.join(target, 'node_modules/vite/dist/node/index.js')))
const { default: react } = await import(pathToFileURL(path.join(target, 'node_modules/@vitejs/plugin-react/dist/index.js')))
const server = await createServer({
  configFile: false, envFile: false, root, cacheDir: path.join(target, '.superpowers/ui-vite'),
  plugins: [react(), { name: 'block-transport', configureServer(s) {
    s.middlewares.use((req, res, next) => {
      if (/^\/(api|ws)(\/|$)/.test(req.url)) { res.statusCode = 403; res.end('Synthetic probe: transport blocked'); return }
      next()
    })
  }}],
  resolve: { alias: [
    { find: '@wheelhouse', replacement: path.join(target, 'src') },
    { find: /^react(\/.*)?$/, replacement: path.join(target, 'node_modules/react') + '$1' },
    { find: /^react-dom(\/.*)?$/, replacement: path.join(target, 'node_modules/react-dom') + '$1' },
  ] },
  server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, fs: { allow: [root, target] } },
})
await server.listen()
console.log(JSON.stringify({ url: server.resolvedUrls.local[0], target, pid: process.pid }))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0) })
