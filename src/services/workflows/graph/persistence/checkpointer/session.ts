import { readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir } from "@/services/system/copy.ts";
import type {
  BaseState,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";

export class SessionDirSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  private checkpointCounter = 0;

  constructor(
    private readonly sessionDirGetter: string | ((state: TState) => string),
  ) {}

  private getCheckpointsDir(sessionDir: string): string {
    return join(sessionDir, "checkpoints");
  }

  private getCheckpointPath(sessionDir: string, label: string): string {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.getCheckpointsDir(sessionDir), `${safeLabel}.json`);
  }

  private generateSequentialLabel(): string {
    this.checkpointCounter++;
    return `node-${String(this.checkpointCounter).padStart(3, "0")}`;
  }

  private resolveSessionDir(state?: TState): string {
    if (typeof this.sessionDirGetter === "string") {
      return this.sessionDirGetter;
    }
    if (!state) {
      throw new Error(
        "SessionDirSaver requires state to resolve dynamic session directory",
      );
    }
    return this.sessionDirGetter(state);
  }

  private async ensureDir(sessionDir: string): Promise<void> {
    await ensureDir(this.getCheckpointsDir(sessionDir));
  }

  private extractCheckpointNumber(label: string): number | null {
    const match = label.match(/^node-(\d+)$/);
    return match?.[1] ? Number.parseInt(match[1], 10) : null;
  }

  async save(
    executionId: string,
    state: TState,
    label?: string,
  ): Promise<void> {
    const sessionDir = this.resolveSessionDir(state);
    await this.ensureDir(sessionDir);

    let checkpointLabel: string;
    let checkpointNumber: number;
    if (label) {
      checkpointLabel = label;
      const extractedNumber = this.extractCheckpointNumber(label);
      if (extractedNumber !== null) {
        checkpointNumber = extractedNumber;
        if (extractedNumber > this.checkpointCounter) {
          this.checkpointCounter = extractedNumber;
        }
      } else {
        checkpointNumber = this.checkpointCounter;
      }
    } else {
      checkpointLabel = this.generateSequentialLabel();
      checkpointNumber = this.checkpointCounter;
    }

    await writeFile(
      this.getCheckpointPath(sessionDir, checkpointLabel),
      JSON.stringify(
        {
          executionId,
          label: checkpointLabel,
          timestamp: new Date().toISOString(),
          checkpointNumber,
          state,
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  async load(_executionId: string): Promise<TState | null> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.load() requires a static session directory. Use loadFromSessionDir() for dynamic session directories.",
      );
    }
    return this.loadFromSessionDir(this.sessionDirGetter, _executionId);
  }

  async loadFromSessionDir(
    sessionDir: string,
    executionId?: string,
  ): Promise<TState | null> {
    const labels = await this.listFromSessionDir(sessionDir);
    if (labels.length === 0) {
      return null;
    }
    return this.loadByLabelFromSessionDir(
      sessionDir,
      labels[labels.length - 1]!,
      executionId,
    );
  }

  async loadByLabel(
    executionId: string,
    label: string,
  ): Promise<TState | null> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.loadByLabel() requires a static session directory. Use loadByLabelFromSessionDir() for dynamic session directories.",
      );
    }
    return this.loadByLabelFromSessionDir(
      this.sessionDirGetter,
      label,
      executionId,
    );
  }

  async loadByLabelFromSessionDir(
    sessionDir: string,
    label: string,
    executionId?: string,
  ): Promise<TState | null> {
    try {
      const data = JSON.parse(
        await Bun.file(this.getCheckpointPath(sessionDir, label)).text(),
      );
      if (executionId && data.executionId !== executionId) {
        return null;
      }
      if (typeof data.checkpointNumber === "number") {
        this.checkpointCounter = data.checkpointNumber;
      }
      return data.state as TState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async list(_executionId: string): Promise<string[]> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.list() requires a static session directory. Use listFromSessionDir() for dynamic session directories.",
      );
    }
    return this.listFromSessionDir(this.sessionDirGetter);
  }

  async listFromSessionDir(sessionDir: string): Promise<string[]> {
    try {
      const files = await readdir(this.getCheckpointsDir(sessionDir));
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

  async delete(_executionId: string, label?: string): Promise<void> {
    if (typeof this.sessionDirGetter !== "string") {
      throw new Error(
        "SessionDirSaver.delete() requires a static session directory. Use deleteFromSessionDir() for dynamic session directories.",
      );
    }
    return this.deleteFromSessionDir(this.sessionDirGetter, label);
  }

  async deleteFromSessionDir(
    sessionDir: string,
    label?: string,
  ): Promise<void> {
    if (!label) {
      try {
        await rm(this.getCheckpointsDir(sessionDir), {
          recursive: true,
          force: true,
        });
        this.checkpointCounter = 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      return;
    }

    try {
      await unlink(this.getCheckpointPath(sessionDir, label));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  getCheckpointCount(): number {
    return this.checkpointCounter;
  }

  resetCounter(): void {
    this.checkpointCounter = 0;
  }
}
