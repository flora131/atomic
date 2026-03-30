import { readdir, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureDir as ensureDirFn } from "@/services/system/copy.ts";
import type {
  BaseState,
  Checkpointer,
} from "@/services/workflows/graph/types.ts";

interface ResearchCheckpointFile {
  frontmatter: {
    executionId: string;
    label: string;
    timestamp: string;
    nodeCount?: number;
  };
  state: unknown;
}

function parseYamlFrontmatter(
  content: string,
): ResearchCheckpointFile | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);
  if (!match) {
    return null;
  }

  const frontmatter: Record<string, string | number> = {};
  for (const line of match[1]!.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      continue;
    }
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    const numValue = Number(value);
    frontmatter[key] = Number.isNaN(numValue) ? value : numValue;
  }

  try {
    return {
      frontmatter: frontmatter as ResearchCheckpointFile["frontmatter"],
      state: JSON.parse(match[2]!),
    };
  } catch {
    return null;
  }
}

function generateYamlFrontmatter(data: ResearchCheckpointFile): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data.frontmatter)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---");
  lines.push(JSON.stringify(data.state, null, 2));
  return lines.join("\n");
}

export class ResearchDirSaver<TState extends BaseState = BaseState>
  implements Checkpointer<TState>
{
  private readonly checkpointsDir: string;

  constructor(researchDir: string = "research") {
    this.checkpointsDir = join(researchDir, "checkpoints");
  }

  private getExecutionDir(executionId: string): string {
    return join(this.checkpointsDir, executionId);
  }

  private getCheckpointPath(executionId: string, label: string): string {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.getExecutionDir(executionId), `${safeLabel}.md`);
  }

  private async ensureDir(executionId: string): Promise<void> {
    await ensureDirFn(this.getExecutionDir(executionId));
  }

  private countNodes(state: TState): number {
    return Object.keys(state.outputs).length;
  }

  async save(
    executionId: string,
    state: TState,
    label?: string,
  ): Promise<void> {
    await this.ensureDir(executionId);
    const checkpointLabel = label ?? `checkpoint_${Date.now()}`;
    const content = generateYamlFrontmatter({
      frontmatter: {
        executionId,
        label: checkpointLabel,
        timestamp: new Date().toISOString(),
        nodeCount: this.countNodes(state),
      },
      state,
    });

    await writeFile(
      this.getCheckpointPath(executionId, checkpointLabel),
      content,
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
      const parsed = parseYamlFrontmatter(
        await Bun.file(this.getCheckpointPath(executionId, label)).text(),
      );
      return (parsed?.state as TState) ?? null;
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
        .filter((file) => file.endsWith(".md"))
        .map((file) => file.replace(".md", ""))
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

  async getMetadata(
    executionId: string,
    label: string,
  ): Promise<ResearchCheckpointFile["frontmatter"] | null> {
    try {
      const parsed = parseYamlFrontmatter(
        await Bun.file(this.getCheckpointPath(executionId, label)).text(),
      );
      return parsed?.frontmatter ?? null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}
