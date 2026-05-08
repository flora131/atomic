import { test } from "bun:test";
import { PanelStore } from "../components/orchestrator-panel-store.ts";
import type { OffloadManagerDeps } from "./offload-manager.ts";

// Compile-time structural assignability — fails to compile if PanelStore
// drifts from OffloadManagerDeps["panelStore"].
function _assertPanelStoreSatisfiesDeps(): void {
  const store = new PanelStore();
  const _check: OffloadManagerDeps["panelStore"] = store;
  void _check;
}
void _assertPanelStoreSatisfiesDeps;

test("PanelStore structurally satisfies OffloadManagerDeps['panelStore'] (compile-time)", () => {
  // The real assertion is the type-only check above.  This test exists to
  // ensure the file is loaded by `bun test` and `bun typecheck`.
});
