# Is the site WordPress?

Type a web address and get a yes or no, with the evidence behind it.

- `site/` is the Spacefast publish folder. It uses the Functions runtime: `functions/index.ts` serves the page and `functions/api/check.ts` runs the check.
- `site/functions/_detect.ts` holds the detection rules. Files starting with `_` aren't routed.
- `npm test` runs offline tests. `npm run test:live` also checks royal.uk (Drupal) and lance.blog (WordPress.com).

Publish with `sf publish site --json`.
