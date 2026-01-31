/**
 * Tools Module Index
 *
 * Re-exports all tool-related types and utilities.
 *
 * Reference: Feature 17 - Create tools module index with exports
 */

// ============================================================================
// TOOL RESULT REGISTRY
// ============================================================================

export {
  // Types
  type ToolRenderProps,
  type ToolRenderResult,
  type ToolRenderer,

  // Individual renderers
  readToolRenderer,
  editToolRenderer,
  bashToolRenderer,
  writeToolRenderer,
  globToolRenderer,
  grepToolRenderer,
  defaultToolRenderer,

  // Registry
  TOOL_RENDERERS,

  // Helper functions
  getToolRenderer,
  getRegisteredToolNames,
  hasCustomRenderer,
  getLanguageFromExtension,
} from "./registry.ts";
