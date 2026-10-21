// POST /functions/v1/activate  { key, machineId, deviceName, appVersion }
import { handleActivate } from "../_shared/handler.ts";
import { serve } from "../_shared/serve.ts";

serve(handleActivate);
