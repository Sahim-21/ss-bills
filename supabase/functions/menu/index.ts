// POST /functions/v1/menu  { action: "put" | "get", key, machineId, snapshot? }
import { MENU_MAX_BODY_BYTES, handleMenu } from "../_shared/handler.ts";
import { serve } from "../_shared/serve.ts";

serve(handleMenu, { maxBytes: MENU_MAX_BODY_BYTES });
