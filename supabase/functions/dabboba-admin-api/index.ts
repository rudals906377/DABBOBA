import { createSupabaseEdgeApiHandler } from "./api.generated.js";

const handler = createSupabaseEdgeApiHandler({
  surface: "admin",
  readEnvironment: () => Deno.env.toObject(),
});

Deno.serve(async (request, info) => handler(request, {
  remoteAddr: {
    hostname: "hostname" in info.remoteAddr ? info.remoteAddr.hostname : undefined,
  },
}));
