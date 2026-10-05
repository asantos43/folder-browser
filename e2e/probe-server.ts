import http from 'node:http'

/** A server on this computer that counts every request it gets: a page that stays closed never reaches it. */
export async function startProbeServer(): Promise<{ origin: string; hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
