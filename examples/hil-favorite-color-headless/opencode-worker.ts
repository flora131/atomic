import { createWorker } from "@bastani/atomic/workflows";
import workflow from "./opencode/index.ts";

const worker = createWorker(workflow);
await worker.start();
