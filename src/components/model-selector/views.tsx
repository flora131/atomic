import React from "react";
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core";
import type { Model } from "@/services/models/model-transform.ts";
import { CONNECTOR, PROMPT } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import type { ThemeColors } from "@/theme/index.tsx";
import type { GroupedModels } from "@/components/model-selector/helpers.ts";
import { getCapabilityInfo } from "@/components/model-selector/helpers.ts";

interface ReasoningOptionViewModel {
  level: string;
  isDefault: boolean;
}

interface ReasoningEffortSelectorProps {
  colors: ThemeColors;
  model: Model;
  options: ReasoningOptionViewModel[];
  selectedIndex: number;
}

export function ReasoningEffortSelector({
  colors,
  model,
  options,
  selectedIndex,
}: ReasoningEffortSelectorProps): React.ReactNode {
  return (
    <box
      flexDirection="column"
      width="100%"
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" paddingLeft={2} paddingBottom={1}>
        <text fg={colors.accent} attributes={1}>
          Select Effort Level for {model.modelID}
        </text>
      </box>

      <box flexDirection="column" paddingLeft={2}>
        {options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const indicator = isSelected ? PROMPT.cursor : " ";

          return (
            <box key={option.level} flexDirection="row" paddingLeft={2}>
              <text fg={isSelected ? colors.accent : colors.muted}>
                {indicator}
              </text>
              <text fg={isSelected ? colors.accent : colors.muted}>
                {" "}{index + 1}.{" "}
              </text>
              <text
                fg={isSelected ? colors.accent : colors.foreground}
                attributes={isSelected ? 1 : undefined}
              >
                {option.level}
              </text>
              {option.isDefault && (
                <text fg={colors.success}>
                  {" "}(default)
                </text>
              )}
            </box>
          );
        })}
      </box>

      <box paddingLeft={2} paddingTop={1}>
        <text fg={colors.muted}>
          Confirm with number keys or ↑↓ keys and Enter, Cancel with Esc
        </text>
      </box>
    </box>
  );
}

interface ModelListViewProps {
  colors: ThemeColors;
  currentModel?: string;
  currentReasoningEffort?: string;
  groupedModels: GroupedModels[];
  flatModelCount: number;
  listHeight: number;
  scrollRef: React.RefObject<ScrollBoxRenderable | null>;
  selectedIndex: number;
  handleMouseScroll: (event: MouseEvent) => void;
}

export function ModelListView({
  colors,
  currentModel,
  currentReasoningEffort,
  groupedModels,
  flatModelCount,
  listHeight,
  scrollRef,
  selectedIndex,
  handleMouseScroll,
}: ModelListViewProps): React.ReactNode {
  let globalIndex = 0;

  return (
    <box
      flexDirection="column"
      width="100%"
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" paddingLeft={2} paddingBottom={1}>
        <text fg={colors.accent} attributes={1}>
          Select Model
        </text>
        <text fg={colors.muted}>
          Choose a model for this session
        </text>
      </box>

      <scrollbox
        ref={scrollRef}
        height={listHeight}
        scrollY={true}
        scrollX={false}
        paddingLeft={SPACING.INDENT}
      >
        {flatModelCount === 0 ? (
          <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
            <text fg={colors.muted}>
              No models available
            </text>
          </box>
        ) : (
          <box flexDirection="column" onMouseScroll={handleMouseScroll}>
            {groupedModels.map((group, groupIndex) => {
              const isLastGroup = groupIndex === groupedModels.length - 1;

              return (
                <box key={group.providerID} flexDirection="column">
                  <box paddingTop={groupIndex > 0 ? 1 : 0}>
                    <text fg={colors.foreground}>
                      {group.displayName}
                    </text>
                  </box>

                  {group.models.map((model) => {
                    const currentGlobalIndex = globalIndex++;
                    const isSelected = currentGlobalIndex === selectedIndex;
                    const isCurrent =
                      model.id === currentModel || model.modelID === currentModel;
                    const contextInfo = getCapabilityInfo(model);
                    const indicator = isSelected ? PROMPT.cursor : " ";
                    const shouldShowCurrentEffort = isCurrent && Boolean(currentReasoningEffort);

                    return (
                      <box
                        key={model.id}
                        flexDirection="row"
                        paddingLeft={2}
                      >
                        <text fg={isSelected ? colors.accent : colors.muted}>
                          {indicator}
                        </text>
                        <text fg={isSelected ? colors.accent : colors.muted}>
                          {" "}{currentGlobalIndex + 1 < 10 ? ` ${currentGlobalIndex + 1}` : currentGlobalIndex + 1}.{" "}
                        </text>
                        <text
                          fg={isSelected
                            ? colors.accent
                            : isCurrent
                              ? colors.success
                              : colors.foreground}
                          attributes={isSelected ? 1 : undefined}
                        >
                          {model.modelID}
                        </text>
                        {shouldShowCurrentEffort && (
                          <text fg={colors.muted}>
                            {" "}({currentReasoningEffort})
                          </text>
                        )}
                        {!shouldShowCurrentEffort
                          && (model.supportedReasoningEfforts?.length ?? 0) > 0
                          && model.defaultReasoningEffort && (
                          <text fg={colors.muted}>
                            {" "}({model.defaultReasoningEffort})
                          </text>
                          )}
                        {isCurrent && (
                          <text fg={colors.success}>
                            {" "}(current)
                          </text>
                        )}
                        {contextInfo && (
                          <text fg={colors.muted}>
                            {"  "}{contextInfo}
                          </text>
                        )}
                      </box>
                    );
                  })}

                  {!isLastGroup && (
                    <box>
                      <text fg={colors.border}>
                        {"  "}{CONNECTOR.horizontal.repeat(30)}
                      </text>
                    </box>
                  )}
                </box>
              );
            })}
          </box>
        )}
      </scrollbox>

      <box paddingLeft={2} paddingTop={1}>
        <text fg={colors.muted}>
          j/k navigate · enter select · esc cancel
        </text>
      </box>
    </box>
  );
}
