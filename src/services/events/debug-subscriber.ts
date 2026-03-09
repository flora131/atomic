/**
 * Compatibility barrel for debug event logging helpers.
 *
 * The implementation now lives under `events/debug-subscriber/`, while the
 * historical `events/debug-subscriber.ts` path remains stable.
 */

export * from "@/services/events/debug-subscriber/index.ts";
