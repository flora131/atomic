/**
 * Patch for MarkdownRenderable text selection.
 *
 * MarkdownRenderable extends Renderable (not TextBufferRenderable), so its
 * shouldStartSelection() always returns false, preventing selection from
 * starting when the hit test returns a MarkdownRenderable. This patch
 * delegates to a bounds check so selection can initiate and then walk into
 * the child TextRenderable instances that hold the actual text.
 *
 * Applied once at module load via a guard flag on the prototype.
 */

import { MarkdownRenderable } from "@opentui/core";

const PATCHED_FLAG = "__markdownSelectionPatched";

if (!(MarkdownRenderable.prototype as unknown as Record<string, unknown>)[PATCHED_FLAG]) {
  MarkdownRenderable.prototype.shouldStartSelection = function (
    x: number,
    y: number,
  ) {
    if (!this.selectable) return false;
    const localX = x - this.x;
    const localY = y - this.y;
    return localX >= 0 && localX < this.width && localY >= 0 && localY < this.height;
  };
  (MarkdownRenderable.prototype as unknown as Record<string, unknown>)[PATCHED_FLAG] = true;
}
