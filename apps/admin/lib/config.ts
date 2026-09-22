import "server-only";

import { loadAdminConfig } from "@dabboba/config";

export function getAdminConfig() {
  return loadAdminConfig(process.env);
}
