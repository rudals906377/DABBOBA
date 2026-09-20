import { createSupabaseEdgeApiHandler } from "./api.generated.js";

Deno.test("bundled Edge API loads and rejects an unprefixed public request before environment access", async () => {
  let environmentRead = false;
  const handler = createSupabaseEdgeApiHandler({
    readEnvironment: () => {
      environmentRead = true;
      return {};
    },
  });
  const response = await handler(new Request("https://example.invalid/v1/healthz"));
  if (!(response instanceof Response)) throw new Error("Supabase Edge API returned no Response");
  const body = await response.json() as { error?: { code?: unknown } };
  if (response.status !== 404 || body.error?.code !== "NOT_FOUND" || environmentRead) {
    throw new Error("Supabase Edge API prefix smoke failed");
  }
});
