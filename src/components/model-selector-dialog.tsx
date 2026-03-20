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

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import type { KeyEvent, ScrollBoxRenderable, MouseEvent } from "@opentui/core";
import { useTheme } from "@/theme/index.tsx";
import type { Model } from "@/services/models/model-transform.ts";
import { navigateUp, navigateDown } from "@/lib/ui/navigation.ts";
import { groupModelsByProvider } from "@/components/model-selector/helpers.ts";
import { ModelListView, ReasoningEffortSelector } from "@/components/model-selector/views.tsx";

export interface ModelSelectorDialogProps {
  /** List of available models */
  models: Model[];
  /** Currently selected model ID */
  currentModel?: string;
  /** Currently selected reasoning effort for the active model */
  currentReasoningEffort?: string;
  /** Callback when a model is selected */
  onSelect: (model: Model, reasoningEffort?: string) => void;
  /** Callback when dialog is cancelled */
  onCancel: () => void;
  /** Whether the dialog is visible */
  visible?: boolean;
}

export function getInitialReasoningIndex(
  model: Model,
  currentModel?: string,
  currentReasoningEffort?: string,
): number {
  const efforts = model.supportedReasoningEfforts ?? [];
  if (efforts.length === 0) {
    return 0;
  }

  const isCurrentModel = model.id === currentModel || model.modelID === currentModel;
  if (isCurrentModel && currentReasoningEffort) {
    const currentEffortIndex = efforts.indexOf(currentReasoningEffort);
    if (currentEffortIndex >= 0) {
      return currentEffortIndex;
    }
  }

  const defaultIndex = efforts.indexOf(model.defaultReasoningEffort ?? "");
  return defaultIndex >= 0 ? defaultIndex : 0;
}

export function ModelSelectorDialog({
  models,
  currentModel,
  currentReasoningEffort,
  onSelect,
  onCancel,
  visible = true,
}: ModelSelectorDialogProps): React.ReactNode {
  const { theme } = useTheme();
  const colors = theme.colors;
  const { height: terminalHeight } = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (currentModel && models.length > 0) {
      const allModels = groupModelsByProvider(models).flatMap((g) => g.models);
      const idx = allModels.findIndex(
        (m) => m.id === currentModel || m.modelID === currentModel
      );
      if (idx !== -1) return idx;
    }
    return 0;
  });
  /** When set, shows the reasoning level selector for this model */
  const [reasoningModel, setReasoningModel] = useState<Model | null>(null);
  const [reasoningIndex, setReasoningIndex] = useState(0);

  // Group models by provider
  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);

  // Flatten for navigation (maintain order)
  const flatModels = useMemo(
    () => groupedModels.flatMap((g) => g.models),
    [groupedModels]
  );

  // Reasoning effort options for the selected model
  const reasoningOptions = useMemo(() => {
    if (!reasoningModel?.supportedReasoningEfforts?.length) return [];
    const options = [...reasoningModel.supportedReasoningEfforts];
    const defaultEffort = reasoningModel.defaultReasoningEffort;
    return options.map((level) => ({
      level,
      isDefault: level === defaultEffort,
    }));
  }, [reasoningModel]);

  // Calculate the row offset of each model within the list content
  const modelRowOffsets = useMemo(() => {
    const offsets: number[] = [];
    let row = 0;
    for (let gi = 0; gi < groupedModels.length; gi++) {
      const group = groupedModels[gi]!;
      if (gi > 0) row += 1; // paddingTop for non-first groups
      row += 1; // provider header
      for (const _model of group.models) {
        offsets.push(row);
        row += 1;
      }
      if (gi < groupedModels.length - 1) {
        row += 1; // separator
      }
    }
    return { offsets, totalRows: row };
  }, [groupedModels]);

  // Reserve space for header (4 rows), footer (2 rows), and outer chat app UI elements
  const maxListHeight = Math.max(5, terminalHeight - 12);
  const listHeight = Math.min(modelRowOffsets.totalRows, maxListHeight);

  // Scroll to keep selected item visible
  useEffect(() => {
    if (!scrollRef.current || flatModels.length === 0) return;
    const scrollBox = scrollRef.current;
    const selectedRow = modelRowOffsets.offsets[selectedIndex] ?? 0;

    if (selectedRow < scrollBox.scrollTop) {
      scrollBox.scrollTo(selectedRow);
    } else if (selectedRow + 1 > scrollBox.scrollTop + listHeight) {
      scrollBox.scrollTo(selectedRow + 1 - listHeight);
    }
  }, [selectedIndex, modelRowOffsets, listHeight]);

  // Translate mouse wheel scroll into selection movement so the highlight follows
  const handleMouseScroll = useCallback((event: MouseEvent) => {
    if (reasoningModel) return;
    const direction = event.scroll?.direction;
    if (direction === "up") {
      setSelectedIndex((prev) => navigateUp(prev, flatModels.length));
    } else if (direction === "down") {
      setSelectedIndex((prev) => navigateDown(prev, flatModels.length));
    }
    event.stopPropagation();
  }, [flatModels.length, reasoningModel]);

  const resolveInitialReasoningIndex = useCallback((model: Model) => {
    return getInitialReasoningIndex(model, currentModel, currentReasoningEffort);
  }, [currentModel, currentReasoningEffort]);

  /** Confirm model selection, showing reasoning selector if applicable */
  const confirmModel = useCallback((model: Model) => {
    if (model.supportedReasoningEfforts?.length) {
      setReasoningModel(model);
      setReasoningIndex(resolveInitialReasoningIndex(model));
    } else {
      onSelect(model);
    }
  }, [onSelect, resolveInitialReasoningIndex]);

  // Handle keyboard navigation
  useKeyboard(
    useCallback(
      (event: KeyEvent): boolean => {
        if (!visible) return false;

        event.stopPropagation();

        const key = event.name ?? "";

        // --- Reasoning level selection phase ---
        if (reasoningModel && reasoningOptions.length > 0) {
          const total = reasoningOptions.length;

          if (key === "up" || key === "k") {
            setReasoningIndex((prev) => (prev <= 0 ? total - 1 : prev - 1));
            return true;
          }
          if (key === "down" || key === "j") {
            setReasoningIndex((prev) => (prev >= total - 1 ? 0 : prev + 1));
            return true;
          }
          if (/^[1-9]$/.test(key)) {
            const num = parseInt(key, 10) - 1;
            if (num < total) {
              setReasoningIndex(num);
              onSelect(reasoningModel, reasoningOptions[num]!.level);
            }
            return true;
          }
          if (key === "return" || key === "linefeed") {
            onSelect(reasoningModel, reasoningOptions[reasoningIndex]!.level);
            return true;
          }
          if (key === "escape") {
            setReasoningModel(null);
            return true;
          }
          return false;
        }

        // --- Model selection phase ---
        const totalItems = flatModels.length;

        // Navigation
        if (key === "up" || key === "k") {
          setSelectedIndex((prev) => navigateUp(prev, totalItems));
          return true;
        }
        if (key === "down" || key === "j") {
          setSelectedIndex((prev) => navigateDown(prev, totalItems));
          return true;
        }

        // Number keys for quick selection (1-9)
        if (/^[1-9]$/.test(key)) {
          const num = parseInt(key, 10) - 1;
          if (num < totalItems) {
            setSelectedIndex(num);
            if (flatModels[num]) {
              confirmModel(flatModels[num]);
            }
          }
          return true;
        }

        // Selection
        if (key === "return" || key === "linefeed") {
          if (flatModels[selectedIndex]) {
            confirmModel(flatModels[selectedIndex]);
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
      [visible, flatModels, selectedIndex, onSelect, onCancel, confirmModel, reasoningModel, reasoningOptions, reasoningIndex]
    )
  );

  if (!visible) return null;

  if (reasoningModel && reasoningOptions.length > 0) {
    return (
      <ReasoningEffortSelector
        colors={colors}
        model={reasoningModel}
        options={reasoningOptions}
        selectedIndex={reasoningIndex}
      />
    );
  }

  return (
    <ModelListView
      colors={colors}
      currentModel={currentModel}
      currentReasoningEffort={currentReasoningEffort}
      groupedModels={groupedModels}
      flatModelCount={flatModels.length}
      listHeight={listHeight}
      scrollRef={scrollRef}
      selectedIndex={selectedIndex}
      handleMouseScroll={handleMouseScroll}
    />
  );
}

export default ModelSelectorDialog;
