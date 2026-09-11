import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHandler, seed } from './club.mjs';
import { getOfficialCalendar, supportedCalendarYears } from './calendar.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export function createApp({ dataDir = process.env.DATA_DIR || resolve(root, 'data'), origin = process.env.PUBLIC_ORIGIN || '', setupToken = process.env.SETUP_TOKEN } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'club.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const adapter = {
    exec: sql => db.exec(sql), prepare: sql => db.prepare(sql),
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  if (!setupToken) {
    const file = resolve(dataDir, 'setup-token.txt');
    if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString('hex'), { mode: 0o600 });
    setupToken = readFileSync(file, 'utf8').trim();
  }
  const readHtml = name => readFileSync(resolve(root, name), 'utf8');
  const snapshot = JSON.parse(readHtml('index.html').match(/id="snapshot">\s*([\s\S]*?)<\/script>/)[1]);
  const handler = createHandler({ db: adapter, initialState: seed(snapshot), setupToken, origin, readHtml });
  const server = http.createServer(async (req, res) => {
    req.setEncoding('utf8');
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/calendar') return handler(req, res);
    const year = Number(url.searchParams.get('year'));
    try {
      if (req.method !== 'GET') throw Object.assign(new Error('僅支援讀取行事曆'), { status: 405 });
      if (!supportedCalendarYears().includes(year)) throw Object.assign(new Error('此年度的行政院行事曆尚未公布'), { status: 404 });
      const body = JSON.stringify(await getOfficialCalendar(year));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      res.end(body);
    } catch (error) {
      res.writeHead(error.status || 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: error.message, supportedYears: supportedCalendarYears() }));
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`落雲宗羽球團：http://localhost:${port}　管理後台：/console.html`);
    console.log('首次使用請讀取 data/setup-token.txt（或 SETUP_TOKEN）並在後台建立掌門帳號。');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close());
}
