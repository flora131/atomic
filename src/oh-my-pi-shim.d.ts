declare module "@oh-my-pi/pi-coding-agent" {
  export interface PromptOptions {
    [key: string]: unknown;
  }

  export interface CreateAgentSessionOptions {
    cwd?: string;
    [key: string]: unknown;
  }

  export interface CompactionResult {
    summary: string;
    firstKeptEntryId: string;
    tokensBefore: number;
    [key: string]: unknown;
  }

  export interface ModelCycleResult {
    [key: string]: unknown;
  }

  export interface AgentSessionEvent {
    type: string;
    [key: string]: unknown;
  }

  export interface AgentSession {
    prompt(text: string, options?: PromptOptions): Promise<string | void>;
    steer(text: string): Promise<void>;
    followUp(text: string): Promise<void>;
    subscribe(listener: (event: AgentSessionEvent) => void): () => void;
    readonly sessionFile: string | undefined;
    readonly sessionId: string;
    setModel(model: unknown): Promise<void>;
    setThinkingLevel(level: unknown): void;
    cycleModel(): Promise<ModelCycleResult | undefined> | ModelCycleResult | undefined;
    cycleThinkingLevel(): unknown;
    readonly agent: unknown;
    readonly model: unknown;
    readonly thinkingLevel: unknown;
    readonly messages: readonly { role?: string; content?: unknown }[];
    readonly isStreaming: boolean;
    navigateTree(...args: unknown[]): Promise<{ cancelled: boolean }>;
    compact(...args: unknown[]): Promise<CompactionResult>;
    abortCompaction(): void;
    abort(): Promise<void>;
    dispose(): void;
  }
}
