import { createSupabaseEdgeWorkerHandler } from "./worker.generated.js";

Deno.test("bundled Edge worker loads and rejects unavailable internal auth without permissions", async () => {
  let environmentRead = false;
  const handler = createSupabaseEdgeWorkerHandler({
    readInvokeSecret: () => undefined,
    readEnvironment: () => {
      environmentRead = true;
      return {};
    },
  });
  const response = await handler(new Request("https://example.invalid/functions/v1/dabboba-worker", {
    method: "POST",
  }));
  const body = await response.json() as { ok?: unknown; code?: unknown };
  if (
    response.status !== 503
    || body.ok !== false
    || body.code !== "WORKER_AUTH_UNAVAILABLE"
    || environmentRead
  ) {
    throw new Error("Supabase Edge worker auth smoke failed");
  }
});
