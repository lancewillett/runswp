import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, decide, InputError, normalizeUrl } from "../site/functions/_detect.ts";
import { GET as checkRoute } from "../site/functions/api/check.ts";
import { GET as pageRoute } from "../site/functions/index.ts";

test("normalizeUrl adds https and rejects unsafe targets", () => {
  assert.equal(normalizeUrl("lance.blog").href, "https://lance.blog/");
  assert.equal(normalizeUrl("  http://Example.com/a#b ").href, "http://example.com/a");
  for (const bad of ["", "localhost", "127.0.0.1", "http://[::1]/", "ftp://example.com", "intranet", "printer.local", "https://u:p@example.com", "example.com:8080"]) {
    assert.throws(() => normalizeUrl(bad), InputError, bad);
  }
});

test("analyze finds WordPress signals and names other platforms", () => {
  const wp = analyze(
    new Headers({ link: '<https://x.com/wp-json/>; rel="https://api.w.org/"' }),
    '<meta content="WordPress 6.8" name="generator"><script src="/wp-includes/js/a.js"></script>',
  );
  assert.equal(wp.platform, "WordPress 6.8");
  assert.equal(decide(wp.evidence), "yes");

  const drupal = analyze(new Headers({ "x-generator": "Drupal 11 (https://www.drupal.org)" }), "<p>hi</p>");
  assert.equal(drupal.otherCms, "Drupal 11");
  assert.equal(decide(drupal.evidence), "no");

  const oneWeak = analyze(new Headers(), '<img src="https://cdn.example/wp-content/x.png">');
  assert.equal(decide(oneWeak.evidence), "unsure");
});

test("page route serves HTML", async () => {
  const res = pageRoute();
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await res.text(), /Is the site WordPress\?/);
});

test("check route rejects bad input with 400", async () => {
  const res = await checkRoute(new Request("https://x.test/api/check?url=localhost"));
  assert.equal(res.status, 400);
});

const live = process.env.LIVE === "1" ? test : test.skip;

live("royal.uk is not WordPress (Drupal)", async () => {
  const res = await checkRoute(new Request("https://x.test/api/check?url=royal.uk"));
  const data = await res.json();
  console.log(JSON.stringify(data));
  assert.equal(data.verdict, "no");
  assert.match(data.otherCms, /Drupal/);
});

live("lance.blog is WordPress", async () => {
  const res = await checkRoute(new Request("https://x.test/api/check?url=lance.blog"));
  const data = await res.json();
  console.log(JSON.stringify(data));
  assert.equal(data.verdict, "yes");
});
