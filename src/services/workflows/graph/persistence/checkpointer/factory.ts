import type {
  BaseState,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";
import { FileSaver } from "@/services/workflows/graph/persistence/checkpointer/file.ts";
import { MemorySaver } from "@/services/workflows/graph/persistence/checkpointer/memory.ts";
import { ResearchDirSaver } from "@/services/workflows/graph/persistence/checkpointer/research.ts";
import { SessionDirSaver } from "@/services/workflows/graph/persistence/checkpointer/session.ts";

export type CheckpointerType = "memory" | "file" | "research" | "session";

export interface CreateCheckpointerOptions<
  TState extends BaseState = BaseState,
> {
  baseDir?: string;
  researchDir?: string;
  sessionDir?: string | ((state: TState) => string);
}

export function createCheckpointer<TState extends BaseState = BaseState>(
  type: CheckpointerType,
  options?: CreateCheckpointerOptions<TState>,
): Checkpointer<TState> {
  switch (type) {
    case "memory":
      return new MemorySaver<TState>();
    case "file":
      if (!options?.baseDir) {
        throw new Error("FileSaver requires baseDir option");
      }
      return new FileSaver<TState>(options.baseDir);
    case "research":
      return new ResearchDirSaver<TState>(options?.researchDir ?? "research");
    case "session":
      if (!options?.sessionDir) {
        throw new Error("SessionDirSaver requires sessionDir option");
      }
      return new SessionDirSaver<TState>(options.sessionDir);
    default:
      throw new Error(`Unknown checkpointer type: ${type}`);
  }
}
