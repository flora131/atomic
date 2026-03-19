import type { OpenCodeAgentMode } from "@/services/agents/types.ts";

export interface OpenCodeClientOptions {
  baseUrl?: string;
  timeout?: number;
  directory?: string;
  maxRetries?: number;
  retryDelay?: number;
  defaultAgentMode?: OpenCodeAgentMode;
  autoStart?: boolean;
  reuseExistingServer?: boolean;
  port?: number;
  hostname?: string;
}

export interface OpenCodeHealthStatus {
  healthy: boolean;
  version?: string;
  uptime?: number;
  error?: string;
}

export interface OpenCodeListableProvider {
  id: string;
  name: string;
  api?: string;
  models?: Record<string, {
    id?: string;
    name?: string;
    family?: string;
    status?: "alpha" | "beta" | "deprecated";
    reasoning?: boolean;
    attachment?: boolean;
    temperature?: boolean;
    tool_call?: boolean;
    capabilities?: {
      reasoning?: boolean;
      attachment?: boolean;
      temperature?: boolean;
      toolcall?: boolean;
    };
    limit?: {
      context?: number;
      input?: number;
      output?: number;
    };
    cost?: {
      input: number;
      output: number;
      cache_read?: number;
      cache_write?: number;
    };
    modalities?: {
      input: string[];
      output: string[];
    };
    options?: Record<string, unknown>;
    headers?: Record<string, string>;
    api?: {
      id?: string;
      url?: string;
      npm?: string;
    };
    variants?: Record<string, {
      disabled?: boolean;
      [key: string]: unknown;
    }>;
  }>;
}
