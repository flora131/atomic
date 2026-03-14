import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRenderer } from "@opentui/react";
import { MacOSScrollAccel, RGBA, SyntaxStyle } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTheme, createMarkdownSyntaxStyle } from "@/theme/index.tsx";
import {
  appendCompactionSummary,
  appendToHistoryBuffer,
  readHistoryBuffer,
  clearHistoryBuffer,
} from "@/state/chat/shared/helpers/conversation-history-buffer.ts";
import { appendUniqueMessagesById } from "@/state/chat/helpers.ts";
import { createClipboardAdapter, type ClipboardAdapter } from "@/lib/ui/clipboard.ts";
import { useVerboseMode } from "@/hooks/use-verbose-mode.ts";
import type { DeferredCommandMessage } from "@/state/chat/command/executor-types.ts";
import type { ChatMessage, WorkflowChatState } from "@/state/chat/types.ts";
import type { WorkflowInputResolver } from "@/services/workflows/helpers/workflow-input-resolver.ts";
import type { Model } from "@/services/models/model-transform.ts";
import type { McpServerToggleMap } from "@/lib/ui/mcp-output.ts";

export interface UseChatShellStateArgs {
  initialModelId?: string;
  model: string;
}

export interface UseChatShellStateResult {
  availableModels: Model[];
  clipboard: ClipboardAdapter;
  commandStyleIdRef: React.MutableRefObject<number>;
  continueQueuedConversationRef: React.MutableRefObject<() => void>;
  currentModelDisplayName?: string;
  currentModelId?: string;
  currentModelRef: React.MutableRefObject<string>;
  copyRendererSelection: () => boolean;
  dispatchDeferredCommandMessageRef: React.MutableRefObject<(message: DeferredCommandMessage) => void>;
  dispatchQueuedMessageRef: React.MutableRefObject<(queuedMessage: import("@/hooks/use-message-queue.ts").QueuedMessage) => void>;
  displayModel: string;
  handleMouseUp: () => void;
  hasRendererSelection: () => boolean;
  historyBufferMessages: ChatMessage[];
  inputFocused: boolean;
  inputSyntaxStyle: SyntaxStyle;
  markdownSyntaxStyle: SyntaxStyle;
  mcpServerToggles: McpServerToggleMap;
  scrollAcceleration: MacOSScrollAccel;
  scrollboxRef: React.MutableRefObject<ScrollBoxRenderable | null>;
  setAvailableModels: React.Dispatch<React.SetStateAction<Model[]>>;
  setCurrentModelDisplayName: React.Dispatch<React.SetStateAction<string | undefined>>;
  setCurrentModelId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setMcpServerToggles: React.Dispatch<React.SetStateAction<McpServerToggleMap>>;
  setShowModelSelector: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTodoPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setTranscriptMode: React.Dispatch<React.SetStateAction<boolean>>;
  setTheme: ReturnType<typeof useTheme>["setTheme"];
  showModelSelector: boolean;
  showTodoPanel: boolean;
  tasksExpanded: boolean;
  theme: ReturnType<typeof useTheme>["theme"];
  themeColors: ReturnType<typeof useTheme>["theme"]["colors"];
  toggleVerbose: () => void;
  toggleTheme: ReturnType<typeof useTheme>["toggleTheme"];
  transcriptMode: boolean;
  waitForUserInputResolverRef: React.MutableRefObject<WorkflowInputResolver | null>;
  workflowActiveRef: React.MutableRefObject<boolean>;
  actions: {
    appendCompactionSummaryAndSync: (summary: string) => void;
    appendHistoryBufferAndSync: (nextMessages: ChatMessage[]) => void;
    clearHistoryBufferAndSync: () => void;
    updateWorkflowState: (
      setWorkflowState: React.Dispatch<React.SetStateAction<WorkflowChatState>>,
      updates: Partial<WorkflowChatState>,
    ) => void;
  };
}

export function useChatShellState({
  initialModelId,
  model,
}: UseChatShellStateArgs): UseChatShellStateResult {
  const renderer = useRenderer();
  const clipboardRef = useRef<ClipboardAdapter | null>(null);
  if (!clipboardRef.current) {
    clipboardRef.current = createClipboardAdapter();
  }
  const clipboard = clipboardRef.current;

  const [transcriptMode, setTranscriptMode] = useState(false);
  const [historyBufferMessages, setHistoryBufferMessages] = useState<ChatMessage[]>([]);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
  const [currentModelDisplayName, setCurrentModelDisplayName] = useState<string | undefined>(undefined);
  const [mcpServerToggles, setMcpServerToggles] = useState<McpServerToggleMap>({});
  const [showTodoPanel, setShowTodoPanel] = useState(true);
  const [inputFocused] = useState(true);
  const [tasksExpanded] = useState(false);

  const displayModel = useMemo(() => {
    if (currentModelDisplayName) {
      return currentModelDisplayName;
    }
    return model;
  }, [currentModelDisplayName, model]);

  const currentModelRef = useRef(initialModelId ?? model);
  useEffect(() => {
    currentModelRef.current = currentModelId ?? initialModelId ?? model;
  }, [currentModelId, initialModelId, model]);

  const { theme, toggleTheme, setTheme } = useTheme();
  const themeColors = theme.colors;
  const { toggle: toggleVerbose } = useVerboseMode();

  const inputSyntaxStyleRef = useRef<SyntaxStyle | null>(null);
  const commandStyleIdRef = useRef<number>(0);
  const inputSyntaxStyle = useMemo(() => {
    if (inputSyntaxStyleRef.current) {
      inputSyntaxStyleRef.current.destroy();
    }
    const style = SyntaxStyle.create();
    const cmdId = style.registerStyle("command", {
      fg: RGBA.fromHex(themeColors.accent),
      bold: true,
    });
    style.registerStyle("mention", {
      fg: RGBA.fromHex(themeColors.accent),
      bold: false,
      underline: false,
    });
    inputSyntaxStyleRef.current = style;
    commandStyleIdRef.current = cmdId;
    return style;
  }, [themeColors.accent]);

  const markdownSyntaxStyle = useMemo(
    () => createMarkdownSyntaxStyle(theme.colors, theme.isDark),
    [theme],
  );

  const waitForUserInputResolverRef = useRef<WorkflowInputResolver | null>(null);
  const workflowActiveRef = useRef(false);
  const scrollAcceleration = useMemo(() => new MacOSScrollAccel(), []);
  const scrollboxRef = useRef<ScrollBoxRenderable>(null);
  const dispatchQueuedMessageRef = useRef<(queuedMessage: import("@/hooks/use-message-queue.ts").QueuedMessage) => void>(() => {});
  const dispatchDeferredCommandMessageRef = useRef<(message: DeferredCommandMessage) => void>(() => {});
  const continueQueuedConversationRef = useRef<() => void>(() => {});

  const clearHistoryBufferAndSync = useCallback(() => {
    clearHistoryBuffer();
    setHistoryBufferMessages([]);
  }, []);

  const appendCompactionSummaryAndSync = useCallback((summary: string) => {
    const summaryMessage = appendCompactionSummary(summary);
    setHistoryBufferMessages(summaryMessage ? [summaryMessage] : []);
  }, []);

  const appendHistoryBufferAndSync = useCallback((nextMessages: ChatMessage[]) => {
    const appended = appendToHistoryBuffer(nextMessages);
    if (appended > 0) {
      setHistoryBufferMessages((prev) => appendUniqueMessagesById(prev, nextMessages));
    }
  }, []);

  useEffect(() => {
    if (!transcriptMode) return;
    let cancelled = false;
    void (async () => {
      const history = await readHistoryBuffer();
      if (!cancelled) {
        setHistoryBufferMessages(history);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transcriptMode]);

  const handleMouseUp = useCallback(() => {
    try {
      const selection = renderer.getSelection();
      if (selection) {
        const selectedText = selection.getSelectedText();
        if (selectedText) {
          clipboard.copy(selectedText);
        }
      }
    } catch {
      // Ignore transitional selection errors
    }
  }, [clipboard, renderer]);

  const copyRendererSelection = useCallback((): boolean => {
    const selection = renderer.getSelection();
    if (!selection) {
      return false;
    }
    const selectedText = selection.getSelectedText();
    if (!selectedText) {
      return false;
    }
    clipboard.copy(selectedText);
    renderer.clearSelection();
    return true;
  }, [clipboard, renderer]);

  const hasRendererSelection = useCallback(() => {
    return Boolean(renderer.getSelection()?.getSelectedText());
  }, [renderer]);

  const updateWorkflowState = useCallback((
    setWorkflowState: React.Dispatch<React.SetStateAction<WorkflowChatState>>,
    updates: Partial<WorkflowChatState>,
  ) => {
    setWorkflowState((prev) => ({ ...prev, ...updates }));
  }, []);

  return {
    availableModels,
    clipboard,
    commandStyleIdRef,
    continueQueuedConversationRef,
    currentModelDisplayName,
    currentModelId,
    currentModelRef,
    copyRendererSelection,
    dispatchDeferredCommandMessageRef,
    dispatchQueuedMessageRef,
    displayModel,
    handleMouseUp,
    hasRendererSelection,
    historyBufferMessages,
    inputFocused,
    inputSyntaxStyle,
    markdownSyntaxStyle,
    mcpServerToggles,
    scrollAcceleration,
    scrollboxRef,
    setAvailableModels,
    setCurrentModelDisplayName,
    setCurrentModelId,
    setMcpServerToggles,
    setShowModelSelector,
    setShowTodoPanel,
    setTranscriptMode,
    setTheme,
    showModelSelector,
    showTodoPanel,
    tasksExpanded,
    theme,
    themeColors,
    toggleVerbose,
    toggleTheme,
    transcriptMode,
    waitForUserInputResolverRef,
    workflowActiveRef,
    actions: {
      appendCompactionSummaryAndSync,
      appendHistoryBufferAndSync,
      clearHistoryBufferAndSync,
      updateWorkflowState,
    },
  };
}
