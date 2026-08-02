import { serve } from "inngest/node";
import { inngest, wardrobeWorkflow } from "../src/workflow/inngest.js";

export const runtime = "nodejs";

export default serve({
  client: inngest,
  functions: [wardrobeWorkflow],
});
