import { createWorkflowCli } from "@bastani/atomic/workflows";
import workflow from "./claude/index.ts";

await createWorkflowCli(workflow).run();
