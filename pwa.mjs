export function versionedHtml(html, version) {
  return html.replace('<meta name="app-version" content="development">',
    '<meta name="app-version" content="' + version + '">')
    .replace('src="/pwa.js"', 'src="/pwa.js?v=' + encodeURIComponent(version) + '"');
}

export function pwaResponse(request, version, serviceWorker) {
  const path = new URL(request.url).pathname;
  if (!['/app-version.json', '/sw.js'].includes(path)) return null;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  const body = path === '/sw.js'
    ? serviceWorker.replace('__LUOYUN_VERSION__', version)
    : JSON.stringify({ version });
  return new Response(request.method === 'HEAD' ? null : body, { headers: {
    ...headers, 'Content-Type': path === '/sw.js' ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8'
  } });
}
