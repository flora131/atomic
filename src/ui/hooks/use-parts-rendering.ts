import { useState } from "react";

/**
 * Feature flag for parts-based rendering.
 * During migration, this defaults to false (legacy rendering).
 * Set to true to enable the new parts-based rendering.
 */
export function usePartsRendering(): boolean {
  // During Phase 3 migration, default to false.
  // Toggle via environment variable or manual override.
  const [enabled] = useState(() => {
    return process.env.ATOMIC_PARTS_RENDERING === "true";
  });
  return enabled;
}
