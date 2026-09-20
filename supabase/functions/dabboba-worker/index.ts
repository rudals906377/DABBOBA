import { createSupabaseEdgeWorkerHandler } from "./worker.generated.js";

Deno.serve(createSupabaseEdgeWorkerHandler({
  readInvokeSecret: () => Deno.env.get("DABBOBA_WORKER_INVOKE_SECRET"),
  // Read the wider environment only after the request passed internal auth.
  readEnvironment: () => Deno.env.toObject(),
}));
