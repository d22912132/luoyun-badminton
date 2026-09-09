import { DurableObject } from 'cloudflare:workers';
import { createHandler, seed } from './club.mjs';
import indexHtml from './index.html';
import consoleHtml from './console.html';

const pages = { '/': indexHtml, '/index.html': indexHtml, '/console.html': consoleHtml };
const snapshot = JSON.parse(indexHtml.match(/id="snapshot">\s*([\s\S]*?)<\/script>/)[1]);
const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' };

export class Club extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // The same transactional domain code runs locally and in Cloudflare's SQLite storage.
    const db = {
      exec: sql => ctx.storage.sql.exec(sql),
      prepare: sql => ({
        get: (...params) => ctx.storage.sql.exec(sql, ...params).toArray()[0],
        run: (...params) => ctx.storage.sql.exec(sql, ...params).toArray()
      }),
      transaction: fn => ctx.storage.transactionSync(fn)
    };
    this.handler = createHandler({ db, initialState: seed(snapshot), setupToken: env.SETUP_TOKEN,
      secureCookies: true, readHtml: () => '' });
  }
  async fetch(request) {
    const url = new URL(request.url);
    const req = {
      method: request.method, url: url.pathname, origin: url.origin,
      headers: Object.fromEntries(request.headers),
      socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || 'local' },
      async *[Symbol.asyncIterator]() {
        if (!request.body) return;
        const reader = request.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read(); if (done) break;
            yield decoder.decode(value, { stream: true });
          }
          yield decoder.decode();
        } finally { await reader.cancel(); reader.releaseLock(); }
      }
    };
    const outgoing = new Headers(); let status = 200, output;
    const res = {
      headersSent: false,
      setHeader: (key, value) => outgoing.set(key, value),
      writeHead(code, values) { status = code; for (const [key, value] of Object.entries(values)) outgoing.set(key, value); },
      end(body) { output = body; this.headersSent = true; }
    };
    await this.handler(req, res);
    return new Response(output, { status, headers: outgoing });
  }
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return env.CLUB.get(env.CLUB.idFromName('luoyun')).fetch(request);
    if (path === '/health') return Response.json({ ok: true });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    if (!Object.hasOwn(pages, path)) return new Response('找不到頁面', { status: 404 });
    const html = pages[path].replace('<head>', '<head><meta name="club-live" content="true">')
      .replace(/(<script type="application\/json" id="snapshot">)[\s\S]*?(<\/script>)/, '$1{}$2');
    return new Response(request.method === 'HEAD' ? null : html, { headers });
  }
};
