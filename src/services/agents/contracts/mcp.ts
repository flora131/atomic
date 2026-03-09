export interface McpServerConfig {
  name: string;
  type?: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  cwd?: string;
  timeout?: number;
  enabled?: boolean;
  disabledReason?: string;
  tools?: string[];
}

export type McpAuthStatus = "Unsupported" | "Not logged in" | "Bearer token" | "OAuth";

export interface McpRuntimeResource {
  name: string;
  title?: string;
  uri: string;
}

export interface McpRuntimeResourceTemplate {
  name: string;
  title?: string;
  uriTemplate: string;
}

export interface McpRuntimeServerSnapshot {
  authStatus?: McpAuthStatus;
  tools?: string[];
  resources?: McpRuntimeResource[];
  resourceTemplates?: McpRuntimeResourceTemplate[];
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
}

export interface McpRuntimeSnapshot {
  servers: Record<string, McpRuntimeServerSnapshot>;
}
