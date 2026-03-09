/**
 * Compatibility barrel for stream event to message-part reduction.
 *
 * The implementation now lives under `state/streaming/pipeline.ts`, while the
 * historical `state/parts/stream-pipeline.ts` path remains stable.
 */

export * from "@/state/streaming/pipeline.ts";
