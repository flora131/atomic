/** @jsxImportSource @opentui/react */

import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, type ReactNode } from "react";
import { PanelStore } from "../../../src/sdk/components/orchestrator-panel-store.ts";
import {
  StoreContext,
  ThemeContext,
  TmuxSessionContext,
} from "../../../src/sdk/components/orchestrator-panel-contexts.ts";
import type { GraphTheme } from "../../../src/sdk/components/graph-theme.ts";

export type ReactTestSetup = Awaited<ReturnType<typeof createTestRenderer>>;

type ActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const actGlobal = globalThis as ActGlobal;

export const TEST_THEME: GraphTheme = {
  background: "#1e1e2e",
  backgroundElement: "#313244",
  text: "#cdd6f4",
  textMuted: "#a6adc8",
  textDim: "#7f849c",
  primary: "#89b4fa",
  success: "#a6e3a1",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#89b4fa",
  mauve: "#cba6f7",
  border: "#585b70",
  borderActive: "#6c7086",
};

function restoreActEnvironment(previousValue: boolean | undefined) {
  if (previousValue === undefined) {
    delete actGlobal.IS_REACT_ACT_ENVIRONMENT;
    return;
  }

  actGlobal.IS_REACT_ACT_ENVIRONMENT = previousValue;
}

export function setReactActEnvironment(value: boolean | undefined) {
  restoreActEnvironment(value);
}

function wrapInputInAct(testSetup: ReactTestSetup) {
  const { mockInput } = testSetup;

  const pressKey = mockInput.pressKey;
  mockInput.pressKey = (key, modifiers) => {
    act(() => {
      pressKey(key, modifiers);
    });
  };

  const pressEnter = mockInput.pressEnter;
  mockInput.pressEnter = (modifiers) => {
    act(() => {
      pressEnter(modifiers);
    });
  };

  const pressEscape = mockInput.pressEscape;
  mockInput.pressEscape = (modifiers) => {
    act(() => {
      pressEscape(modifiers);
    });
  };

  const pressTab = mockInput.pressTab;
  mockInput.pressTab = (modifiers) => {
    act(() => {
      pressTab(modifiers);
    });
  };

  const pressBackspace = mockInput.pressBackspace;
  mockInput.pressBackspace = (modifiers) => {
    act(() => {
      pressBackspace(modifiers);
    });
  };

  const pressArrow = mockInput.pressArrow;
  mockInput.pressArrow = (direction, modifiers) => {
    act(() => {
      pressArrow(direction, modifiers);
    });
  };

  const pressCtrlC = mockInput.pressCtrlC;
  mockInput.pressCtrlC = () => {
    act(() => {
      pressCtrlC();
    });
  };

  const pressKeys = mockInput.pressKeys;
  mockInput.pressKeys = async (keys, delayMs) => {
    await act(async () => {
      await pressKeys(keys, delayMs);
    });
  };

  const typeText = mockInput.typeText;
  mockInput.typeText = async (text, delayMs) => {
    await act(async () => {
      await typeText(text, delayMs);
    });
  };

  const pasteBracketedText = mockInput.pasteBracketedText;
  mockInput.pasteBracketedText = async (text) => {
    await act(async () => {
      await pasteBracketedText(text);
    });
  };
}

export async function renderReact(
  node: ReactNode,
  options: TestRendererOptions,
): Promise<ReactTestSetup> {
  const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;

  let testSetup: ReactTestSetup;
  try {
    testSetup = await createTestRenderer({
      ...options,
      screenMode: options.screenMode ?? "main-screen",
      footerHeight: options.footerHeight ?? 12,
      consoleMode: options.consoleMode ?? "disabled",
      externalOutputMode: options.externalOutputMode ?? "passthrough",
    });
  } catch (error) {
    restoreActEnvironment(previousActEnvironment);
    throw error;
  }

  const root = createRoot(testSetup.renderer);
  const renderOnce = testSetup.renderOnce;
  testSetup.renderOnce = async () => {
    await act(async () => {
      await renderOnce();
    });
  };

  const resize = testSetup.resize;
  testSetup.resize = (width, height) => {
    act(() => {
      resize(width, height);
    });
  };

  wrapInputInAct(testSetup);

  const destroy = testSetup.renderer.destroy.bind(testSetup.renderer);
  let destroyed = false;
  testSetup.renderer.destroy = () => {
    if (destroyed) {
      return;
    }

    destroyed = true;
    try {
      act(() => {
        root.unmount();
        destroy();
      });
    } finally {
      restoreActEnvironment(previousActEnvironment);
    }
  };

  try {
    await act(async () => {
      root.render(node);
    });
  } catch (error) {
    testSetup.renderer.destroy();
    throw error;
  }

  return testSetup;
}

export function TestProviders({
  store,
  theme,
  tmuxSession,
  children,
}: {
  store: PanelStore;
  theme?: GraphTheme;
  tmuxSession?: string;
  children: ReactNode;
}) {
  return (
    <StoreContext.Provider value={store}>
      <ThemeContext.Provider value={theme ?? TEST_THEME}>
        <TmuxSessionContext.Provider value={tmuxSession ?? "test-session"}>
          {children}
        </TmuxSessionContext.Provider>
      </ThemeContext.Provider>
    </StoreContext.Provider>
  );
}
