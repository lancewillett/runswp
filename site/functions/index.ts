import { PAGE } from "./_page.ts";

export function GET(): Response {
  return new Response(PAGE, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
