import { createWorkflowCli } from "@bastani/atomic/workflows";
import workflow from "./copilot/index.ts";

await createWorkflowCli(workflow).run();
