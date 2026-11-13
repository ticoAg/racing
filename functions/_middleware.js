// A page asked for as Markdown gets its Markdown twin (the index.md the build writes beside every index.html):
//   curl -H 'Accept: text/markdown' https://racing.ticoag.fun/models/h9/
// Browsers and everything else get the page itself. Runs only on the pages' own addresses (public/_routes.json).

// Markdown is wanted when the Accept header names it and does not rank text/html above it.
export function wantsMarkdown(accept) {
  let md = 0, html = 0, mdAt = -1, htmlAt = -1;
  (accept || '').split(',').forEach((part, i) => {
    const [type, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim().match(/^q=([\d.]+)$/)).filter(Boolean).map((m) => parseFloat(m[1]))[0];
    const w = Number.isFinite(q) ? q : 1;
    if (type.trim() === 'text/markdown') { md = w; mdAt = i; }
    if (type.trim() === 'text/html') { html = w; htmlAt = i; }
  });
  return md > 0 && (md > html || (md === html && (htmlAt < 0 || mdAt < htmlAt)));
}

// a rough count for a reader that budgets its context: a token per CJK character, one per four other characters
export function tokens(text) {
  const cjk = (text.match(/[⺀-鿿豈-﫿＀-￯]/g) || []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !url.pathname.endsWith('/')) return next();
  if (wantsMarkdown(request.headers.get('Accept'))) {
    const twin = await env.ASSETS.fetch(new Request(new URL(url.pathname + 'index.md', url), { method: 'GET' }));
    if (twin.ok) {
      const text = await twin.text();
      return new Response(request.method === 'HEAD' ? null : text, {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Vary': 'Accept',
          'Cache-Control': 'public, max-age=0, must-revalidate',
          'X-Markdown-Tokens': String(tokens(text)),
          'Content-Signal': 'search=yes, ai-input=yes, ai-train=yes',
          'Link': `<${(text.match(/^url: (\S+)$/m) || [])[1] || url.origin + url.pathname}>; rel="canonical"`,
          'X-Robots-Tag': 'noindex',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }
  // the page itself: the same address answers differently by Accept, and caches are told so
  const page = await next();
  const res = new Response(page.body, page);
  res.headers.append('Vary', 'Accept');
  return res;
}
