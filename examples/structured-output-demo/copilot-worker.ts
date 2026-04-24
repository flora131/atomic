import { createWorker } from "@bastani/atomic/workflows";
import workflow from "./copilot/index.ts";

const worker = createWorker(workflow);
await worker.start();
