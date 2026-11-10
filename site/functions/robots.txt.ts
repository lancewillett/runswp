export function GET(): Response {
  return new Response("User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: https://runswp.com/sitemap.xml\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
