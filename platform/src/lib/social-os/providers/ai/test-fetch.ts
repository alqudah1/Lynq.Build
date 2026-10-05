/** Test-only fetch double: ordered (matcher → response) routes; records calls; unmatched requests fail loudly. No DB imports. */
export type FakeRoute = { match: (url: string, init?: RequestInit) => boolean; respond: (url: string, init?: RequestInit) => { status?: number; json?: unknown; text?: string; bytes?: Uint8Array; headers?: Record<string, string> } };

export function makeFakeFetch(routes: FakeRoute[]) {
  const calls: { url: string; init?: RequestInit; body?: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    let body: unknown;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, init, body, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])) });
    const route = routes.find((r) => r.match(url, init));
    if (!route) return new Response(JSON.stringify({ error: { message: `unexpected ${init?.method ?? "GET"} ${url}` } }), { status: 599 });
    const out = route.respond(url, init);
    if (out.bytes) return new Response(out.bytes as unknown as BodyInit, { status: out.status ?? 200, headers: out.headers ?? {} });
    if (out.status === 204) return new Response(null, { status: 204 });
    const text = out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? "");
    return new Response(text, { status: out.status ?? 200, headers: { "content-type": out.json !== undefined ? "application/json" : "text/plain", ...(out.headers ?? {}) } });
  };
  return { fetchImpl, calls };
}
