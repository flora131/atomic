import { useState } from "react";

/**
 * Feature flag for parts-based rendering.
 * @todo Remove this flag and make parts-based rendering the default
 * once migration is fully validated in production.
 * Set ATOMIC_PARTS_RENDERING=true to enable the new rendering.
 */
export function usePartsRendering(): boolean {
  // During Phase 3 migration, default to false.
  // Toggle via environment variable or manual override.
  const [enabled] = useState(() => {
    return process.env.ATOMIC_PARTS_RENDERING === "true";
  });
  return enabled;
}
