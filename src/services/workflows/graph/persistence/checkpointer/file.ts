import { readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir } from "@/services/system/copy.ts";
import type {
  BaseState,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";

export class FileSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  constructor(private readonly baseDir: string) {}

  private getExecutionDir(executionId: string): string {
    return join(this.baseDir, executionId);
  }

  private getCheckpointPath(executionId: string, label: string): string {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.getExecutionDir(executionId), `${safeLabel}.json`);
  }

  private async ensureDir(executionId: string): Promise<void> {
    await ensureDir(this.getExecutionDir(executionId));
  }

  async save(
    executionId: string,
    state: TState,
    label?: string,
  ): Promise<void> {
    await this.ensureDir(executionId);
    const checkpointLabel = label ?? `checkpoint_${Date.now()}`;
    const filePath = this.getCheckpointPath(executionId, checkpointLabel);

    await writeFile(
      filePath,
      JSON.stringify(
        {
          label: checkpointLabel,
          timestamp: new Date().toISOString(),
          state,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  async load(executionId: string): Promise<TState | null> {
    const labels = await this.list(executionId);
    if (labels.length === 0) {
      return null;
    }
    return this.loadByLabel(executionId, labels[labels.length - 1]!);
  }

  async loadByLabel(
    executionId: string,
    label: string,
  ): Promise<TState | null> {
    try {
      const content = await Bun.file(
        this.getCheckpointPath(executionId, label),
      ).text();
      const data = JSON.parse(content);
      return data.state as TState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async list(executionId: string): Promise<string[]> {
    try {
      const files = await readdir(this.getExecutionDir(executionId));
      return files
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.replace(".json", ""))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async delete(executionId: string, label?: string): Promise<void> {
    if (!label) {
      try {
        await rm(this.getExecutionDir(executionId), {
          recursive: true,
          force: true,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    try {
      await unlink(this.getCheckpointPath(executionId, label));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
}
