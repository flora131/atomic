import { createWorkflowCli } from "@bastani/atomic/workflows";
import workflow from "./opencode/index.ts";

await createWorkflowCli(workflow).run();
