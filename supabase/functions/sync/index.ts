// POST /functions/v1/sync  { key, machineId, appVersion, summaries: [...] }
import { handleSync } from "../_shared/handler.ts";
import { serve } from "../_shared/serve.ts";

serve(handleSync);
