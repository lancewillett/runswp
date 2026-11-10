export type Strength = "strong" | "weak";

export interface Evidence {
  signal: string;
  detail: string;
  strength: Strength;
}

export type Verdict = "yes" | "no" | "unsure";

export interface CheckResult {
  host: string;
  url: string;
  finalUrl: string;
  status: number;
  verdict: Verdict;
  platform?: string;
  otherCms?: string;
  clue?: string;
  framework?: string;
  theme?: string;
  reason?: string;
  evidence: Evidence[];
}

export class InputError extends Error {}
export class FetchError extends Error {}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const USER_AGENT =
  "Mozilla/5.0 (compatible; RunsWP/1.0; +https://runswp.com)";
const PAGE_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 5000;
const PAGE_BYTES = 1_500_000;
const PROBE_BYTES = 300_000;
const MAX_REDIRECTS = 5;

export function normalizeUrl(raw: string): URL {
  const text = raw.trim();
  if (!text) throw new InputError("Enter a site address.");
  if (text.length > 2048) throw new InputError("That address is too long.");

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InputError("That doesn't look like a web address.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InputError("Only http and https addresses work.");
  }
  if (url.username || url.password) throw new InputError("Leave out the username and password.");
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new InputError("Only standard web ports work.");
  }

  const host = url.hostname.toLowerCase();
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) {
    throw new InputError("Enter a domain name, not an IP address.");
  }
  if (
    !host.includes(".") ||
    host === "localhost" ||
    /\.(localhost|local|internal|lan|home|test|invalid)$/.test(host)
  ) {
    throw new InputError("Enter a public domain name, like example.com.");
  }

  url.hash = "";
  return url;
}

async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= cap) await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(total, cap));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.length - offset;
    if (room <= 0) break;
    bytes.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return new TextDecoder().decode(bytes);
}

function describeFetchError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return "The site took too long to answer.";
  return "Couldn't reach that site.";
}

async function fetchPage(start: URL, fetchImpl: FetchLike) {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current.href, {
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8" },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FetchError(describeFetchError(err));
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      try {
        current = normalizeUrl(new URL(location, current).href);
      } catch {
        throw new FetchError("The site redirected somewhere we can't follow.");
      }
      continue;
    }
    const body = await readCapped(res, PAGE_BYTES).catch(() => "");
    return { res, finalUrl: current, body };
  }
  throw new FetchError("The site redirected too many times.");
}

async function probeRestApi(origin: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const res = await fetchImpl(`${origin}/wp-json/`, {
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return false;
    }
    const data = JSON.parse(await readCapped(res, PROBE_BYTES));
    return Array.isArray(data?.namespaces) && data.namespaces.includes("wp/v2");
  } catch {
    return false;
  }
}

function cleanName(value: string): string {
  return value.replace(/\s*\(https?:[^)]*\)\s*$/, "").trim().slice(0, 100);
}

function metaGenerators(html: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']?generator["']?/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const value = (content?.[1] ?? content?.[2] ?? "").trim();
    if (value) found.push(cleanName(value));
  }
  return found;
}

type Fingerprint = { name: string; test: (h: Headers, html: string, headerText: string, host: string) => string | null };

const onHost = (host: string, suffix: string) => host === suffix || host.endsWith(`.${suffix}`);

const when = (cond: boolean, clue: string) => (cond ? clue : null);
const assetHost = (name: string, host: string): Fingerprint => ({
  name,
  test: (_h, html) => when(html.includes(host), `The page loads assets from ${host}.`),
});

const CMS_FINGERPRINTS: Fingerprint[] = [
  {
    name: "Adobe Experience Manager",
    test: (_h, html, headerText) =>
      when(headerText.includes("adobeaemcloud.com"), "A response header names an Adobe AEM Cloud host.") ??
      when(html.includes("/etc.clientlibs/"), "The page loads assets from /etc.clientlibs/, an AEM path."),
  },
  {
    name: "Drupal",
    test: (h, html) =>
      when(h.has("x-drupal-cache") || h.has("x-drupal-dynamic-cache"), "The response has Drupal cache headers.") ??
      when(html.includes("drupal-settings-json") || html.includes("/sites/default/files/"), "The page has Drupal settings or file paths."),
  },
  { name: "Sitecore", test: (_h, html) => when(/sitecore/i.test(html) && html.includes("/-/media/"), "The page uses Sitecore media paths (/-/media/).") },
  { name: "Blogger", test: (_h, _html, _t, host) => when(onHost(host, "blogspot.com"), "The site is on blogspot.com.") },
  {
    name: "Tumblr",
    test: (h, _html, _t, host) => when(h.has("x-tumblr-user") || onHost(host, "tumblr.com"), "The site is on Tumblr."),
  },
  { name: "LiveJournal", test: (_h, _html, _t, host) => when(onHost(host, "livejournal.com"), "The site is on livejournal.com.") },
  { name: "Typepad", test: (_h, _html, _t, host) => when(onHost(host, "typepad.com"), "The site is on typepad.com.") },
  {
    name: "Ghost",
    test: (h, _html, _t, host) =>
      when(h.has("x-ghost-cache-status"), "The response has Ghost cache headers.") ??
      when(onHost(host, "ghost.io"), "The site is on ghost.io."),
  },
  {
    name: "ExpressionEngine",
    test: (_h, _html, headerText) => when(/set-cookie: [^\n]*\bexp_[a-z_]+=/.test(headerText), "The site sets ExpressionEngine exp_ cookies."),
  },
  { name: "Shopify", test: (h, html) => when(h.has("x-shopify-stage") || html.includes("cdn.shopify.com"), "The page loads from Shopify's CDN.") },
  {
    name: "Wix",
    test: (h, html) =>
      when(h.has("x-wix-request-id") || h.has("x-wix-dispatcher-cache-hit") || html.includes("static.wixstatic.com"), "The page is served by Wix."),
  },
  {
    name: "Squarespace",
    test: (h, html) =>
      when(/squarespace/i.test(h.get("server") ?? "") || html.includes("static1.squarespace.com"), "The page is served by Squarespace."),
  },
  { name: "Webflow", test: (_h, html) => when(/\bdata-wf-site=/.test(html), "The page carries Webflow's data-wf-site marker.") },
  { name: "HubSpot CMS", test: (h) => when(h.has("x-hs-hub-id") || h.has("x-hs-cache-config"), "The response has HubSpot headers.") },
  { name: "Craft CMS", test: (h) => when(/craft cms/i.test(h.get("x-powered-by") ?? ""), "The server says it runs Craft CMS.") },
  { name: "Joomla", test: (_h, html) => when(html.includes("/media/jui/") || html.includes("/media/system/js/core"), "The page loads Joomla's core scripts.") },
  { name: "TYPO3", test: (_h, html) => when(html.includes("typo3temp/") || html.includes("/typo3conf/"), "The page has TYPO3 file paths.") },
  assetHost("Contentful", "ctfassets.net"),
  assetHost("Sanity", "cdn.sanity.io"),
  assetHost("Storyblok", "a.storyblok.com"),
  assetHost("Prismic", "images.prismic.io"),
  assetHost("Contentstack", "images.contentstack.io"),
  assetHost("Builder.io", "cdn.builder.io"),
  assetHost("Framer", "framerusercontent.com"),
  assetHost("Weebly", "editmysite.com"),
  assetHost("Duda", "multiscreensite.com"),
];

const FRAMEWORK_FINGERPRINTS: Fingerprint[] = [
  { name: "Next.js", test: (h, html) => when(/next\.js/i.test(h.get("x-powered-by") ?? "") || html.includes("/_next/static/"), "Next.js") },
  { name: "Nuxt", test: (_h, html) => when(html.includes("/_nuxt/"), "Nuxt") },
  { name: "Gatsby", test: (_h, html) => when(html.includes('id="___gatsby"'), "Gatsby") },
  { name: "Astro", test: (_h, html) => when(html.includes("/_astro/"), "Astro") },
  { name: "SvelteKit", test: (_h, html) => when(html.includes("/_app/immutable/"), "SvelteKit") },
  { name: "Remix", test: (_h, html) => when(html.includes("__remixContext"), "Remix") },
];

function firstMatch(list: Fingerprint[], h: Headers, html: string, headerText: string, host: string) {
  for (const fp of list) {
    const clue = fp.test(h, html, headerText, host);
    if (clue) return { name: fp.name, clue };
  }
  return undefined;
}

export function analyze(headers: Headers, html: string, host = "") {
  const evidence: Evidence[] = [];
  const add = (signal: string, detail: string, strength: Strength) =>
    evidence.push({ signal, detail, strength });

  if (/rel\s*=\s*"?https:\/\/api\.w\.org\/"?/i.test(headers.get("link") ?? "")) {
    add("REST API link header", "The response points to a WordPress REST API (api.w.org).", "strong");
  } else if (/<link\b[^>]*rel=["']https:\/\/api\.w\.org\/["']/i.test(html)) {
    add("REST API link tag", "The page links to a WordPress REST API (api.w.org).", "strong");
  }

  if (headers.has("x-hacker") || /^wordpress\.com$/i.test(headers.get("host-header") ?? "")) {
    add("WordPress.com headers", "The response carries headers that WordPress.com sends.", "strong");
  }

  if (headers.has("x-pingback")) {
    add("Pingback header", "The response advertises a WordPress-style XML-RPC pingback endpoint.", "strong");
  }

  let platform: string | undefined;
  let otherCms: string | undefined;
  let clue: string | undefined;
  const headerGenerator = headers.get("x-generator");
  const generators = [...metaGenerators(html), headerGenerator ? cleanName(headerGenerator) : ""].filter(Boolean);
  for (const generator of generators) {
    if (/^wordpress/i.test(generator)) {
      platform ??= generator;
      add("Generator tag", `The page says it was generated by “${generator}”.`, "strong");
      break;
    }
  }
  if (!platform) {
    otherCms = generators.find((g) => !/^wordpress/i.test(g));
    if (otherCms) clue = `The page says it was generated by “${otherCms}”.`;
  }

  const poweredBy = headers.get("x-powered-by") ?? "";
  if (/wordpress|wp engine|wpvip/i.test(poweredBy)) {
    add("Powered-by header", `The server says “${poweredBy.slice(0, 80)}”.`, "strong");
  }

  const includes = html.match(/\/wp-includes\//g)?.length ?? 0;
  const content = html.match(/\/wp-content\//g)?.length ?? 0;
  if (includes > 0) {
    add("Core file paths", `Found ${includes} reference${includes === 1 ? "" : "s"} to /wp-includes/.`, "strong");
  }
  if (content > 0) {
    add("Theme and plugin paths", `Found ${content} reference${content === 1 ? "" : "s"} to /wp-content/.`, "weak");
  }
  if (/\bclass=["'][^"']*\bwp-block-/i.test(html)) {
    add("Block editor markup", "The page uses wp-block CSS classes from the block editor.", "weak");
  }

  if (!platform && evidence.some((e) => e.signal === "WordPress.com headers")) platform = "WordPress.com";

  const headerText = [...headers].map(([k, v]) => `${k}: ${v}`).join("\n").toLowerCase();
  if (!otherCms) {
    const cms = firstMatch(CMS_FINGERPRINTS, headers, html, headerText, host);
    otherCms = cms?.name;
    clue = cms?.clue;
  }
  const framework = firstMatch(FRAMEWORK_FINGERPRINTS, headers, html, headerText, host)?.name;
  const theme = html.match(/\/wp-content\/themes\/(?:pub\/|premium\/)?([a-z0-9_-]+)\//i)?.[1];

  return { evidence, platform, otherCms, clue, framework, theme };
}

export function decide(evidence: Evidence[]): Verdict {
  const strong = evidence.filter((e) => e.strength === "strong").length;
  const weak = evidence.length - strong;
  if (strong > 0 || weak >= 2) return "yes";
  if (weak === 1) return "unsure";
  return "no";
}

export async function check(raw: string, fetchImpl: FetchLike = fetch): Promise<CheckResult> {
  const start = normalizeUrl(raw);
  const { res, finalUrl, body } = await fetchPage(start, fetchImpl);
  const { evidence, platform, otherCms, clue, framework, theme } = analyze(res.headers, body, finalUrl.hostname);

  if (!evidence.some((e) => e.strength === "strong") && (await probeRestApi(finalUrl.origin, fetchImpl))) {
    evidence.push({
      signal: "REST API",
      detail: `${finalUrl.origin}/wp-json/ answers with the WordPress wp/v2 API.`,
      strength: "strong",
    });
  }

  let verdict = decide(evidence);
  if (verdict === "unsure" && otherCms) verdict = "no";
  let reason: string | undefined;
  if (verdict === "no" && !otherCms && !res.ok) {
    verdict = "unsure";
    reason = res.headers.has("cf-mitigated")
      ? "The site blocked the check with bot protection."
      : `The site answered with HTTP ${res.status}, so there wasn't a page to inspect.`;
  }

  return {
    host: start.hostname,
    url: start.href,
    finalUrl: finalUrl.href,
    status: res.status,
    verdict,
    platform,
    otherCms: verdict === "yes" ? undefined : otherCms,
    clue: verdict === "yes" ? undefined : clue,
    framework: verdict === "yes" ? undefined : framework,
    theme: verdict === "yes" ? theme : undefined,
    reason,
    evidence,
  };
}
