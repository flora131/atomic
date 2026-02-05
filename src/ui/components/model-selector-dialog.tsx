/**
 * ModelSelectorDialog Component for Interactive Model Selection
 *
 * A refined dialog component that displays available models grouped by provider.
 * Features:
 * - Keyboard navigation (j/k, arrows, number keys)
 * - Provider-based grouping with visual hierarchy
 * - Elegant selection indicators and current model markers
 * - Capability badges for model features
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { useKeyboard } from "@opentui/react";
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
  displayName: string;
  models: Model[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Provider display names */
const PROVIDER_CONFIG: Record<string, { name: string }> = {
  anthropic: { name: "Anthropic" },
  "github-copilot": { name: "GitHub Copilot" },
  openai: { name: "OpenAI" },
  google: { name: "Google" },
  opencode: { name: "OpenCode" },
  default: { name: "Other" },
};


// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get provider display config
 */
function getProviderConfig(providerID: string): { name: string } {
  return PROVIDER_CONFIG[providerID] ?? PROVIDER_CONFIG["default"]!;
}

/**
 * Group models by provider
 */
function groupModelsByProvider(models: Model[]): GroupedModels[] {
  const groups = new Map<string, Model[]>();

  for (const model of models) {
    const arr = groups.get(model.providerID) ?? [];
    arr.push(model);
    groups.set(model.providerID, arr);
  }

  // Sort providers: anthropic first, then alphabetically
  const sortedProviders = Array.from(groups.keys()).sort((a, b) => {
    if (a === "anthropic") return -1;
    if (b === "anthropic") return 1;
    return a.localeCompare(b);
  });

  return sortedProviders.map((providerID) => ({
    providerID,
    displayName: getProviderConfig(providerID).name,
    models: groups.get(providerID) ?? [],
  }));
}

/**
 * Format context window size
 */
function formatContextSize(context: number): string {
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M`;
  if (context >= 1000) return `${Math.round(context / 1000)}k`;
  return String(context);
}

/**
 * Get capability info for a model (context size only, no icons)
 */
function getCapabilityInfo(model: Model): string | null {
  if (model.limits?.context) {
    return formatContextSize(model.limits.context);
  }
  return null;
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

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Group models by provider
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);

  // Flatten for navigation (maintain order)
  const flatModels = useMemo(
    () => groupedModels.flatMap((g) => g.models),
    [groupedModels]
  );

  // Find index of current model on mount
  useEffect(() => {
    if (currentModel && flatModels.length > 0) {
      const idx = flatModels.findIndex(
        (m) => m.id === currentModel || m.modelID === currentModel
      );
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

        event.stopPropagation();

        const key = event.name ?? "";
        const totalItems = flatModels.length;

        // Navigation
        if (key === "up" || key === "k") {
          setSelectedIndex((prev) => (prev <= 0 ? totalItems - 1 : prev - 1));
          return true;
        }
        if (key === "down" || key === "j") {
          setSelectedIndex((prev) => (prev >= totalItems - 1 ? 0 : prev + 1));
          return true;
        }

        // Number keys for quick selection (1-9)
        if (/^[1-9]$/.test(key)) {
          const num = parseInt(key, 10) - 1;
          if (num < totalItems) {
            setSelectedIndex(num);
            if (flatModels[num]) {
              onSelect(flatModels[num]);
            }
          }
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

        return false;
      },
      [visible, flatModels, selectedIndex, onSelect, onCancel]
    )
  );

  if (!visible) return null;

  // Calculate global index for each model
  let globalIndex = 0;

  return (
    <box
      style={{
        flexDirection: "column",
        width: "100%",
        paddingTop: 1,
        paddingBottom: 1,
      }}
    >
      {/* Header */}
      <box style={{ flexDirection: "column", paddingLeft: 2, paddingBottom: 1 }}>
        <text style={{ fg: colors.accent }} attributes={1}>
          Select Model
        </text>
        <text style={{ fg: colors.muted }}>
          Choose a model for this session
        </text>
      </box>

      {/* Models List - Grouped by Provider */}
      <box
        style={{
          flexDirection: "column",
          paddingLeft: 2,
        }}
      >
        {flatModels.length === 0 ? (
          <box style={{ paddingLeft: 2, paddingTop: 1, paddingBottom: 1 }}>
            <text style={{ fg: colors.muted }}>
              No models available
            </text>
          </box>
        ) : (
          groupedModels.map((group, groupIdx) => {
            const config = getProviderConfig(group.providerID);
            const isLastGroup = groupIdx === groupedModels.length - 1;

            return (
              <box key={group.providerID} style={{ flexDirection: "column" }}>
                {/* Provider Header */}
                <box style={{ paddingTop: groupIdx > 0 ? 1 : 0 }}>
                  <text style={{ fg: colors.foreground }}>
                    {config.name}
                  </text>
                </box>

                {/* Models in this group */}
                {group.models.map((model) => {
                  const currentGlobalIndex = globalIndex++;
                  const isSelected = currentGlobalIndex === selectedIndex;
                  const isCurrent =
                    model.id === currentModel || model.modelID === currentModel;
                  const contextInfo = getCapabilityInfo(model);

                  // Selection indicator and number
                  const indicator = isSelected ? "❯" : " ";
                  const number = currentGlobalIndex + 1;

                  return (
                    <box
                      key={model.id}
                      style={{
                        flexDirection: "row",
                        paddingLeft: 2,
                      }}
                    >
                      {/* Selection indicator */}
                      <text
                        style={{
                          fg: isSelected ? colors.accent : colors.muted,
                        }}
                      >
                        {indicator}
                      </text>

                      {/* Number */}
                      <text
                        style={{
                          fg: isSelected ? colors.accent : colors.muted,
                        }}
                      >
                        {" "}{number < 10 ? ` ${number}` : number}.{" "}
                      </text>

                      {/* Model name */}
                      <text
                        style={{
                          fg: isSelected
                            ? colors.accent
                            : isCurrent
                              ? colors.success
                              : colors.foreground,
                        }}
                        attributes={isSelected ? 1 : undefined}
                      >
                        {model.name}
                      </text>

                      {/* Current marker */}
                      {isCurrent && (
                        <text style={{ fg: colors.success }}>
                          {" "}(current)
                        </text>
                      )}

                      {/* Context size info */}
                      {contextInfo && (
                        <text style={{ fg: colors.muted }}>
                          {"  "}{contextInfo}
                        </text>
                      )}
                    </box>
                  );
                })}

                {/* Separator between groups */}
                {!isLastGroup && (
                  <box style={{ paddingTop: 0 }}>
                    <text style={{ fg: colors.border }}>
                      {"  "}{"─".repeat(30)}
                    </text>
                  </box>
                )}
              </box>
            );
          })
        )}
      </box>

      {/* Footer */}
      <box style={{ paddingLeft: 2, paddingTop: 1 }}>
        <text style={{ fg: colors.muted }}>
          j/k navigate · enter select · esc cancel
        </text>
      </box>
    </box>
  );
}

export default ModelSelectorDialog;
