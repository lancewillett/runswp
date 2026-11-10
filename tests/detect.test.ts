import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, check, decide, FetchError, isCloudflareIp, normalizeUrl, InputError, uiLibraryIn } from "../site/functions/_detect.ts";
import { GET as checkRoute } from "../site/functions/api/check.ts";
import { GET as pageRoute } from "../site/functions/index.ts";

type Reply = Response | Error | ((url: string) => Response);

// Fake fetch: exact-URL replies, 404 for anything else. Records every URL requested.
function fakeFetch(replies: Record<string, Reply>) {
  const requested: string[] = [];
  const impl = async (url: string) => {
    requested.push(url);
    const reply = replies[url];
    if (reply instanceof Error) throw reply;
    if (typeof reply === "function") return reply(url);
    return reply ?? new Response("not found", { status: 404 });
  };
  return { impl, requested };
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" }, ...init });
const doh = (...ips: string[]) =>
  Response.json({ Answer: ips.map((data) => ({ type: 1, data })) });
const DOH = (host: string) => `https://cloudflare-dns.com/dns-query?name=${host}&type=A`;

test("normalizeUrl adds https, lowercases the host and drops the fragment", () => {
  assert.equal(normalizeUrl("lance.blog").href, "https://lance.blog/");
  assert.equal(normalizeUrl("  http://Example.com/a#b ").href, "http://example.com/a");
});

test("normalizeUrl rejects targets a public checker must not fetch", () => {
  for (const bad of ["", "localhost", "127.0.0.1", "http://[::1]/", "ftp://example.com", "intranet", "printer.local", "https://u:p@example.com", "example.com:8080"]) {
    assert.throws(() => normalizeUrl(bad), InputError, bad);
  }
});

test("analyze says yes and reads the version when the page has WordPress signals", () => {
  const wp = analyze(
    new Headers({ link: '<https://x.com/wp-json/>; rel="https://api.w.org/"' }),
    '<meta content="WordPress 6.8" name="generator"><script src="/wp-includes/js/a.js"></script>',
  );
  assert.equal(wp.platform, "WordPress 6.8");
  assert.equal(decide(wp.evidence), "yes");
});

test("analyze says unsure when only one weak WordPress signal shows", () => {
  const oneWeak = analyze(new Headers(), '<img src="https://cdn.example/wp-content/x.png">');
  assert.equal(decide(oneWeak.evidence), "unsure");
});

test("analyze reports WordPress.com and the theme from x-hacker plus theme path", () => {
  const wpcom = analyze(new Headers({ "x-hacker": "Want root?" }), '<link href="/wp-content/themes/twentytwentyfive/style.css">');
  assert.equal(wpcom.platform, "WordPress.com");
  assert.equal(wpcom.theme, "twentytwentyfive");
  assert.equal(decide(wpcom.evidence), "yes");
});

test("analyze names a generator-tagged CMS and says no", () => {
  const drupal = analyze(new Headers({ "x-generator": "Drupal 11 (https://www.drupal.org)" }), "<p>hi</p>");
  assert.equal(drupal.otherCms, "Drupal 11");
  assert.equal(decide(drupal.evidence), "no");
});

test("analyze names other platforms by header, host and cookie", () => {
  const aem = analyze(new Headers({ "x-debug-forwarded-host": "publish-p1-e2.adobeaemcloud.com" }), "<p>hi</p>");
  assert.equal(aem.otherCms, "Adobe Experience Manager");
  assert.equal(decide(aem.evidence), "no");

  assert.equal(analyze(new Headers(), "<p>hi</p>", "someone.blogspot.com").otherCms, "Blogger");
  assert.equal(analyze(new Headers(), "<p>hi</p>", "staff.tumblr.com").otherCms, "Tumblr");
  assert.equal(analyze(new Headers({ "set-cookie": "exp_tracker=abc; path=/" }), "").otherCms, "ExpressionEngine");
});

test("analyze treats Next.js as a framework, but a headless CMS asset host as the CMS", () => {
  const next = analyze(new Headers(), '<script src="/_next/static/chunks/main.js"></script>');
  assert.equal(next.otherCms, undefined);
  assert.equal(next.framework, "Next.js");

  const contentfulNext = analyze(new Headers(), '<img src="https://images.ctfassets.net/x.png"><script src="/_next/static/a.js"></script>');
  assert.equal(contentfulNext.otherCms, "Contentful");
  assert.equal(contentfulNext.framework, "Next.js");
});

test("analyze spots a Vite app shell and does not call Cloudflare edge headers hosting", () => {
  const shell = analyze(
    new Headers({ server: "cloudflare", "cf-ray": "abc-LAX" }),
    '<script type="module" crossorigin src="/assets/index-eMIulc_q.js"></script>',
  );
  assert.equal(shell.otherCms, undefined);
  assert.equal(shell.framework, "Vite");
  assert.equal(shell.hosting, undefined);
});

test("analyze names Vercel hosting from its request header", () => {
  assert.equal(analyze(new Headers({ "x-vercel-id": "sfo1::x" }), "").hosting, "Vercel");
});

test("analyze names GitHub Pages from x-github-request-id even when server says cloudflare", () => {
  const headers = new Headers({ server: "cloudflare", "x-github-request-id": "DD72:39DC3F", "x-fastly-request-id": "0b0c" });
  assert.equal(analyze(headers, "").hosting, "GitHub Pages");
});

test("analyze treats a framework or site-generator generator tag as no CMS", () => {
  const astro = analyze(new Headers(), '<meta name="generator" content="Astro v7.3.8">');
  assert.equal(astro.otherCms, undefined);
  assert.equal(astro.framework, "Astro");
  assert.equal(astro.clue, "The page says it was generated by “Astro v7.3.8”.");

  const jekyll = analyze(new Headers(), '<meta name="generator" content="Jekyll v3.10.0">');
  assert.equal(jekyll.otherCms, undefined);
  assert.equal(jekyll.framework, "Jekyll");
});

test("isCloudflareIp accepts Cloudflare ranges and rejects other or malformed addresses", () => {
  assert.equal(isCloudflareIp("172.67.191.32"), true);
  assert.equal(isCloudflareIp("104.21.60.34"), true);
  assert.equal(isCloudflareIp("192.0.78.24"), false);
  assert.equal(isCloudflareIp("not-an-ip"), false);
});

test("uiLibraryIn names the library from bundle code, and Preact only without react-dom", () => {
  assert.equal(uiLibraryIn('import{createRoot}from"react-dom/client"'), "React");
  assert.equal(uiLibraryIn("window.__VUE__=1"), "Vue");
  assert.equal(uiLibraryIn('from"preact/hooks"'), "Preact");
  assert.equal(uiLibraryIn("plain code"), undefined);
});

test("check follows redirects and reports the final URL", async () => {
  const { impl } = fakeFetch({
    "http://old.example.com/": new Response(null, { status: 301, headers: { location: "https://www.example.com/home" } }),
    "https://www.example.com/home": html('<script src="/wp-includes/a.js"></script>'),
  });
  const result = await check("http://old.example.com", impl);
  assert.equal(result.finalUrl, "https://www.example.com/home");
  assert.equal(result.verdict, "yes");
});

test("check refuses a redirect to an internal address and never requests it", async () => {
  const { impl, requested } = fakeFetch({
    "https://evil.example.com/": new Response(null, { status: 302, headers: { location: "http://localhost/admin" } }),
  });
  await assert.rejects(check("evil.example.com", impl), FetchError);
  assert.deepEqual(requested, ["https://evil.example.com/"]);
});

test("check gives up with FetchError on a redirect loop", async () => {
  const loop = () => new Response(null, { status: 302, headers: { location: "https://loop.example.com/" } });
  const { impl } = fakeFetch({ "https://loop.example.com/": loop });
  await assert.rejects(check("loop.example.com", impl), /too many times/);
});

test("check reports a timeout as FetchError with a timeout message", async () => {
  const { impl } = fakeFetch({ "https://slow.example.com/": new DOMException("t", "TimeoutError") });
  await assert.rejects(check("slow.example.com", impl), (err: Error) => err instanceof FetchError && /too long/.test(err.message));
});

test("check says yes when the page is bare but /wp-json/ answers with wp/v2", async () => {
  const { impl } = fakeFetch({
    "https://bare.example.com/": html("<p>hi</p>"),
    "https://bare.example.com/wp-json/": Response.json({ namespaces: ["oembed/1.0", "wp/v2"] }),
  });
  const result = await check("bare.example.com", impl);
  assert.equal(result.verdict, "yes");
  assert.equal(result.evidence[0].signal, "REST API");
});

test("check says unsure with a bot-protection reason when the site answers 403 with cf-mitigated", async () => {
  const { impl } = fakeFetch({
    "https://blocked.example.com/": new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } }),
  });
  const result = await check("blocked.example.com", impl);
  assert.equal(result.verdict, "unsure");
  assert.equal(result.reason, "The site blocked the check with bot protection.");
});

test("check labels hosting Cloudflare when the host resolves to a Cloudflare IP", async () => {
  const { impl } = fakeFetch({
    "https://cf.example.com/": html("<p>hi</p>"),
    [DOH("cf.example.com")]: doh("104.21.60.34"),
  });
  assert.equal((await check("cf.example.com", impl)).hosting, "Cloudflare");
});

test("check leaves hosting empty when the host resolves outside Cloudflare", async () => {
  const { impl } = fakeFetch({
    "https://plain.example.com/": html("<p>hi</p>"),
    [DOH("plain.example.com")]: doh("192.0.78.24"),
  });
  assert.equal((await check("plain.example.com", impl)).hosting, undefined);
});

test("check reads the same-origin app bundle to name the UI library", async () => {
  const { impl } = fakeFetch({
    "https://app.example.com/": html('<script type="module" src="/assets/index-eMIulc_q.js"></script>'),
    "https://app.example.com/assets/index-eMIulc_q.js": new Response('import"react-dom/client"'),
  });
  const result = await check("app.example.com", impl);
  assert.equal(result.verdict, "no");
  assert.equal(result.uiLibrary, "React");
});

test("check never fetches a script served from another origin", async () => {
  const { impl, requested } = fakeFetch({
    "https://app.example.com/": html('<script type="module" src="https://other.example.net/assets/index-eMIulc_q.js"></script>'),
  });
  const result = await check("app.example.com", impl);
  assert.equal(result.uiLibrary, undefined);
  assert.ok(!requested.some((u) => u.startsWith("https://other.example.net")));
});

test("page route serves HTML", async () => {
  const res = pageRoute();
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<h1>Runs WP\?<\/h1>/);
  assert.match(html, /rel="canonical" href="https:\/\/runswp\.com\/"/);
});

test("check route rejects bad input with 400", async () => {
  const res = await checkRoute(new Request("https://x.test/api/check?url=localhost"));
  assert.equal(res.status, 400);
});

test("check route maps an unreachable site to 502 with the error message", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("connect failed");
  }) as typeof fetch;
  try {
    const res = await checkRoute(new Request("https://x.test/api/check?url=down.example.com"));
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "Couldn't reach that site." });
  } finally {
    globalThis.fetch = realFetch;
  }
});

const live = process.env.LIVE === "1" ? test : test.skip;

const lookup = async (site: string) => (await checkRoute(new Request(`https://x.test/api/check?url=${site}`))).json();

live("royal.uk is not WordPress (Drupal)", async () => {
  const data = await lookup("royal.uk");
  assert.equal(data.verdict, "no");
  assert.match(data.otherCms, /Drupal/);
});

live("snowflake.com runs Adobe Experience Manager", async () => {
  const data = await lookup("snowflake.com");
  assert.equal(data.verdict, "no");
  assert.equal(data.otherCms, "Adobe Experience Manager");
});

live("staff.tumblr.com is Tumblr, not unsure", async () => {
  const data = await lookup("staff.tumblr.com");
  assert.equal(data.verdict, "no");
  assert.equal(data.otherCms, "Tumblr");
});

live("brocklefferts.com is a hand-built React app on Cloudflare", async () => {
  const data = await lookup("brocklefferts.com");
  assert.equal(data.verdict, "no");
  assert.equal(data.otherCms, undefined);
  assert.equal(data.uiLibrary, "React");
  assert.equal(data.framework, "Vite");
  assert.equal(data.hosting, "Cloudflare");
});

live("pages.github.com is a Jekyll site on GitHub Pages", async () => {
  const data = await lookup("pages.github.com");
  assert.equal(data.verdict, "no");
  assert.equal(data.otherCms, undefined);
  assert.equal(data.framework, "Jekyll");
  assert.equal(data.hosting, "GitHub Pages");
});

live("lance.blog is WordPress and is not labeled as served by Cloudflare", async () => {
  const data = await lookup("lance.blog");
  assert.equal(data.verdict, "yes");
  assert.equal(data.hosting, undefined);
});
