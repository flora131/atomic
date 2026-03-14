/**
 * Event bus public type surface.
 *
 * All data types are derived from the Zod schemas in schemas.ts
 * via z.infer<> — the schemas are the single source of truth.
 */

import type { z } from "zod";
import type { BusEventSchemas } from "./schemas.ts";

export type BusEventType = keyof typeof BusEventSchemas;

export type BusEventDataMap = {
  [K in BusEventType]: z.infer<(typeof BusEventSchemas)[K]>;
};

export interface BusEvent<T extends BusEventType = BusEventType> {
  type: T;
  sessionId: string;
  runId: number;
  timestamp: number;
  data: BusEventDataMap[T];
}

export type BusHandler<T extends BusEventType> = (event: BusEvent<T>) => void;

export type WildcardHandler = (event: BusEvent) => void;

export interface EnrichedBusEvent extends BusEvent {
  resolvedToolId?: string;
  resolvedAgentId?: string;
  isSubagentTool?: boolean;
  suppressFromMainChat?: boolean;
  parentAgentId?: string;
}
