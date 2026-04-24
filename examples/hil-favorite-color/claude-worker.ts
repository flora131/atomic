import { createWorker } from "@bastani/atomic/workflows";
import workflow from "./claude/index.ts";

const worker = createWorker(workflow);
await worker.start();
