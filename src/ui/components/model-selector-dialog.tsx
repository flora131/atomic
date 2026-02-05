/**
 * ModelSelectorDialog Component for Interactive Model Selection
 *
 * A dialog component that displays available models in a searchable list,
 * inspired by OpenCode's model selector. Features:
 * - Fuzzy search filtering
 * - Keyboard navigation (j/k, arrows)
 * - Grouped by provider
 * - Context size and status display
 *
 * Reference: OpenCode's DialogModel component pattern
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { KeyEvent } from "@opentui/core";
import { useTheme } from "../theme.tsx";
import type { Model } from "../../models/model-transform.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface ModelSelectorDialogProps {
  /** List of available models */
  models: Model[];
  /** Currently selected model ID */
  currentModel?: string;
  /** Callback when a model is selected */
  onSelect: (model: Model) => void;
  /** Callback when dialog is cancelled */
  onCancel: () => void;
  /** Whether the dialog is visible */
  visible?: boolean;
}

interface GroupedModels {
  providerID: string;
  providerName: string;
  models: Model[];
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Simple fuzzy match - checks if query characters appear in order in target
 */
function fuzzyMatch(query: string, target: string): boolean {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  let queryIndex = 0;
  for (let i = 0; i < lowerTarget.length && queryIndex < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }
  return queryIndex === lowerQuery.length;
}

/**
 * Group models by provider
 */
function groupModelsByProvider(models: Model[]): GroupedModels[] {
  const grouped = new Map<string, Model[]>();

  for (const model of models) {
    const arr = grouped.get(model.providerID) ?? [];
    arr.push(model);
    grouped.set(model.providerID, arr);
  }

  // Sort providers alphabetically, with anthropic and openai first
  const priorityProviders = ['anthropic', 'openai'];
  const entries = Array.from(grouped.entries()).sort((a, b) => {
    const aIdx = priorityProviders.indexOf(a[0]);
    const bIdx = priorityProviders.indexOf(b[0]);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a[0].localeCompare(b[0]);
  });

  return entries.map(([providerID, providerModels]) => ({
    providerID,
    providerName: providerID.charAt(0).toUpperCase() + providerID.slice(1),
    models: providerModels.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

/**
 * Flatten grouped models into a flat list for navigation
 */
function flattenGroupedModels(groups: GroupedModels[]): Model[] {
  return groups.flatMap(g => g.models);
}

/**
 * Format context size for display
 */
function formatContextSize(limits?: { context?: number }): string {
  if (!limits?.context) return '';
  const ctx = limits.context;
  if (ctx >= 1000000) return `${Math.round(ctx / 1000000)}M ctx`;
  if (ctx >= 1000) return `${Math.round(ctx / 1000)}k ctx`;
  return `${ctx} ctx`;
}

// ============================================================================
// MODEL SELECTOR DIALOG COMPONENT
// ============================================================================

export function ModelSelectorDialog({
  models,
  currentModel,
  onSelect,
  onCancel,
  visible = true,
}: ModelSelectorDialogProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { height: terminalHeight } = useTerminalDimensions();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filter models based on search query
  const filteredModels = useMemo(() => {
    if (!searchQuery) return models;
    return models.filter(model =>
      fuzzyMatch(searchQuery, model.name) ||
      fuzzyMatch(searchQuery, model.id) ||
      fuzzyMatch(searchQuery, model.providerID) ||
      (model.family && fuzzyMatch(searchQuery, model.family))
    );
  }, [models, searchQuery]);

  // Group filtered models
  const groupedModels = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels]);
  const flatModels = useMemo(() => flattenGroupedModels(groupedModels), [groupedModels]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Find index of current model
  useEffect(() => {
    if (currentModel && flatModels.length > 0) {
      const idx = flatModels.findIndex(m => m.id === currentModel);
      if (idx !== -1) {
        setSelectedIndex(idx);
      }
    }
  }, [currentModel, flatModels]);

  // Handle keyboard navigation
  useKeyboard(
    useCallback(
      (event: KeyEvent): boolean => {
        if (!visible) return false;

        // Stop propagation to prevent other handlers from running
        event.stopPropagation();

        const key = event.name ?? "";
        const totalItems = flatModels.length;

        // Navigation
        if (key === "up" || key === "k") {
          setSelectedIndex(prev => (prev <= 0 ? totalItems - 1 : prev - 1));
          return true;
        }
        if (key === "down" || key === "j") {
          setSelectedIndex(prev => (prev >= totalItems - 1 ? 0 : prev + 1));
          return true;
        }

        // Page navigation
        if (key === "pageup") {
          setSelectedIndex(prev => Math.max(0, prev - 10));
          return true;
        }
        if (key === "pagedown") {
          setSelectedIndex(prev => Math.min(totalItems - 1, prev + 10));
          return true;
        }

        // Selection
        if (key === "return" || key === "linefeed") {
          if (flatModels[selectedIndex]) {
            onSelect(flatModels[selectedIndex]);
          }
          return true;
        }

        // Cancel
        if (key === "escape") {
          onCancel();
          return true;
        }

        // Search input - allow alphanumeric and common characters
        if (key.length === 1 && /[\w\-./]/.test(key)) {
          setSearchQuery(prev => prev + key);
          return true;
        }

        // Backspace
        if (key === "backspace") {
          setSearchQuery(prev => prev.slice(0, -1));
          return true;
        }

        return false;
      },
      [visible, flatModels, selectedIndex, onSelect, onCancel]
    )
  );

  if (!visible) return null;

  // Calculate dimensions
  const maxVisibleItems = Math.min(15, terminalHeight - 10);

  // Calculate scroll offset to keep selected item visible
  const scrollOffset = Math.max(0, selectedIndex - Math.floor(maxVisibleItems / 2));

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
      }}
    >
      {/* Header */}
      <box style={{ flexDirection: "column", padding: 1 }}>
        <text style={{ fg: colors.accent }}>Select Model</text>
        <text style={{ fg: colors.muted }}>
          Use arrows or j/k to navigate, Enter to select, Esc to cancel
        </text>
      </box>

      {/* Search Input */}
      <box style={{ padding: 1 }}>
        <text style={{ fg: colors.muted }}>Search: </text>
        <text style={{ fg: searchQuery ? colors.accent : colors.muted }}>
          {searchQuery || "Type to filter..."}
        </text>
      </box>

      {/* Models List */}
      <box
        style={{
          flexDirection: "column",
          padding: 1,
          flexGrow: 1,
        }}
      >
        {groupedModels.length === 0 ? (
          <text style={{ fg: colors.muted }}>
            No models found matching "{searchQuery}"
          </text>
        ) : (
          groupedModels.map((group) => {
            // Find the first model index for this group in flat list
            const groupStartIndex = flatModels.findIndex(
              m => m.providerID === group.providerID
            );

            // Check if any model in this group should be visible
            const groupEndIndex = groupStartIndex + group.models.length - 1;
            const visibleStart = scrollOffset;
            const visibleEnd = scrollOffset + maxVisibleItems - 1;

            // Skip group if entirely outside visible range
            if (groupEndIndex < visibleStart || groupStartIndex > visibleEnd) {
              return null;
            }

            return (
              <box key={group.providerID} style={{ flexDirection: "column" }}>
                {/* Provider Header */}
                <text style={{ fg: colors.accent }}>
                  {group.providerName}
                </text>

                {/* Models in this provider */}
                {group.models.map((model) => {
                  const modelIndex = flatModels.indexOf(model);
                  const isSelected = modelIndex === selectedIndex;
                  const isCurrent = model.id === currentModel;

                  // Skip if outside visible range
                  if (modelIndex < scrollOffset || modelIndex >= scrollOffset + maxVisibleItems) {
                    return null;
                  }

                  const contextStr = formatContextSize(model.limits);
                  const statusStr = model.status && model.status !== 'active'
                    ? `[${model.status}]`
                    : '';

                  // Build the display text
                  let displayText = `  ${isSelected ? ">" : " "} ${model.modelID || model.name}`;
                  if (isCurrent) displayText += " (current)";
                  if (contextStr) displayText += ` (${contextStr})`;
                  if (statusStr) displayText += ` ${statusStr}`;

                  return (
                    <text
                      key={model.id}
                      style={{
                        fg: isSelected ? colors.accent : (isCurrent ? colors.success : colors.foreground),
                      }}
                    >
                      {displayText}
                    </text>
                  );
                })}
              </box>
            );
          })
        )}
      </box>

      {/* Footer */}
      <box style={{ padding: 1 }}>
        <text style={{ fg: colors.muted }}>
          {flatModels.length} model{flatModels.length !== 1 ? 's' : ''} available
          {searchQuery && ` (filtered from ${models.length})`}
        </text>
      </box>
    </box>
  );
}

export default ModelSelectorDialog;
