export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Does this site run WordPress? · RunsWP</title>
<meta name="description" content="Type a web address and find out whether the site runs WordPress, or which CMS it uses instead, with the evidence behind the answer.">
<link rel="canonical" href="https://runswp.com/">
<meta property="og:site_name" content="RunsWP">
<meta property="og:url" content="https://runswp.com/">
<meta property="og:title" content="Does this site run WordPress?">
<meta property="og:description" content="Type a web address and find out whether the site runs WordPress, or which CMS it uses instead.">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%233858e9'/%3E%3Ctext x='16' y='22' font-family='Georgia,serif' font-size='18' font-weight='700' text-anchor='middle' fill='white'%3E%3F%3C/text%3E%3C/svg%3E">
<style>
:root {
  --bg: #f7f7f5; --surface: #ffffff; --text: #1d1d1f; --muted: #5f6368; --border: #d9d9d6;
  --accent: #3858e9; --accent-text: #ffffff; --yes: #0a7c42; --no: #b3261e; --unsure: #8a5a00;
  --radius: 14px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #121214; --surface: #1c1c1f; --text: #f2f2f3; --muted: #a5a5ab; --border: #34343a;
    --accent: #7b93ff; --accent-text: #0d0d10; --yes: #4cd38a; --no: #ff8a80; --unsure: #f2c063;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; background: var(--bg); color: var(--text);
  font: 17px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  display: flex; flex-direction: column;
}
main { width: 100%; max-width: 640px; margin: 0 auto; padding: 12vh 16px 48px; flex: 1; }
h1 { font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 7vw, 3rem); line-height: 1.1; margin: 0 0 8px; letter-spacing: -0.01em; }
.lede { color: var(--muted); margin: 0 0 28px; }
form { display: flex; gap: 8px; }
.field-label { display: block; font-weight: 600; margin-bottom: 8px; }
.skip { position: absolute; left: -9999px; top: 8px; background: var(--surface); color: var(--text); padding: 8px 12px; border-radius: 8px; }
.skip:focus { left: 16px; }
input[type=text] {
  flex: 1; min-width: 0; font: inherit; padding: 14px 16px; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
}
input[type=text]:focus-visible, button:focus-visible, summary:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
button {
  font: inherit; font-weight: 600; padding: 14px 22px; border-radius: var(--radius); border: 0;
  background: var(--accent); color: var(--accent-text); cursor: pointer;
}
button:hover { filter: brightness(1.08); }
button[disabled] { opacity: 0.6; cursor: progress; }
#result { margin-top: 36px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px; }
.answer { font-family: Georgia, "Times New Roman", serif; font-size: clamp(3rem, 14vw, 5rem); line-height: 1; font-weight: 700; margin: 0 0 12px; }
.answer.yes { color: var(--yes); } .answer.no { color: var(--no); } .answer.unsure { color: var(--unsure); }
.summary { margin: 0; font-size: 1.1rem; overflow-wrap: anywhere; }
.error { color: var(--no); margin: 0; }
.note { margin: 8px 0 0; color: var(--muted); overflow-wrap: anywhere; }
details { margin-top: 18px; }
summary { cursor: pointer; color: var(--muted); }
ul.evidence { margin: 12px 0 0; padding-left: 20px; }
ul.evidence li { margin-bottom: 6px; }
.tag { font-size: 0.8rem; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; margin-left: 6px; white-space: nowrap; }
.loading { color: var(--muted); }
footer { color: var(--muted); font-size: 0.85rem; text-align: center; padding: 24px 16px; }
footer p { margin: 0 0 6px; }
footer a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
footer a:hover { color: var(--text); }
footer a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
@media (max-width: 420px) { form { flex-direction: column; } button { width: 100%; } }
</style>
</head>
<body>
<a class="skip" href="#url">Skip to the address field</a>
<main id="main">
  <h1>Runs WP?</h1>
  <p class="lede">Type a web address to find out whether the site runs WordPress. If it doesn't, you'll see which CMS it uses instead.</p>
  <label class="field-label" for="url">Site address</label>
  <form id="check" novalidate>
    <input id="url" name="url" type="text" inputmode="url" autocomplete="url" autocapitalize="off" spellcheck="false" placeholder="example.com" required>
    <button type="submit">Check</button>
  </form>
  <div id="result" aria-live="polite"></div>
</main>
<footer>
  <p>Checks the home page and the WordPress REST API. Some sites block automated checks.</p>
  <p>Built by Lance Willett with <a href="https://spacefast.com/">Spacefast</a>.</p>
</footer>
<script>
const form = document.getElementById("check");
const input = document.getElementById("url");
const button = form.querySelector("button");
const out = document.getElementById("result");

function el(tag, attrs, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
}

const STATIC_SITE_GENERATORS = ["Jekyll", "Hugo", "Eleventy", "Hexo", "Docusaurus", "VitePress", "Zola", "MkDocs", "Pelican"];

function appName(data) {
  return (data.framework && data.framework !== "Vite" ? data.framework : "") || data.uiLibrary || "";
}

function handBuilt(data) {
  const name = appName(data);
  if (name) return " Hand-built " + name + (STATIC_SITE_GENERATORS.includes(name) ? " site." : " app.");
  return data.framework ? " Hand-built app." : "";
}

function render(data) {
  out.replaceChildren();
  const card = el("div", { class: "card" });
  if (data.error) {
    card.append(el("p", { class: "error" }, data.error));
    out.append(card);
    return;
  }
  const words = { yes: "Yes.", no: "No.", unsure: "Not sure." };
  card.append(el("p", { class: "answer " + data.verdict }, words[data.verdict]));
  let line;
  if (data.verdict === "yes") line = data.host + " runs WordPress" + (data.platform && data.platform !== "WordPress" ? " (" + data.platform + ")." : ".");
  else if (data.verdict === "no") line = data.otherCms ? data.host + " runs " + data.otherCms + "." : "No CMS detected." + handBuilt(data);
  else line = data.reason || "One weak sign of WordPress on " + data.host + ", not enough to say yes.";
  card.append(el("p", { class: "summary" }, line));

  const notes = [];
  if (data.theme) notes.push("Theme: " + data.theme);
  if (data.clue) notes.push("How we know: " + data.clue);
  if (data.framework && data.framework !== appName(data)) notes.push("Built with " + data.framework + ".");
  if (data.hosting) notes.push("Served by " + data.hosting + ".");
  for (const note of notes) card.append(el("p", { class: "note" }, note));

  if (data.evidence && data.evidence.length) {
    const details = el("details");
    details.append(el("summary", {}, "Evidence (" + data.evidence.length + ")"));
    const list = el("ul", { class: "evidence" });
    for (const e of data.evidence) {
      const li = el("li");
      li.append(el("strong", {}, e.signal + ": "), document.createTextNode(e.detail), el("span", { class: "tag" }, e.strength));
      list.append(li);
    }
    details.append(list);
    card.append(details);
  }
  out.append(card);
}

async function run(value, push) {
  value = value.trim();
  if (!value) { input.focus(); return; }
  button.disabled = true;
  out.replaceChildren(el("p", { class: "loading" }, "Checking " + value + "…"));
  if (push) history.replaceState(null, "", "?url=" + encodeURIComponent(value));
  try {
    const res = await fetch("/api/check?url=" + encodeURIComponent(value));
    render(await res.json());
  } catch {
    render({ error: "Couldn't run the check. Try again." });
  } finally {
    button.disabled = false;
  }
}

form.addEventListener("submit", (e) => { e.preventDefault(); run(input.value, true); });
const initial = new URLSearchParams(location.search).get("url");
if (initial) { input.value = initial; run(initial, false); } else { input.focus(); }
</script>
</body>
</html>
`;
