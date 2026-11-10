import { check, FetchError, InputError } from "../_detect.ts";

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("url") ?? "";
  try {
    const result = await check(raw);
    return Response.json(result, { headers: { "cache-control": "public, max-age=300", "x-robots-tag": "noindex" } });
  } catch (err) {
    if (err instanceof InputError) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof FetchError) return Response.json({ error: err.message }, { status: 502 });
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}
