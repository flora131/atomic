/**
 * Unit tests for ChatShellProps decomposition into sub-interfaces.
 *
 * Verifies that:
 * - All sub-interfaces are importable
 * - ChatShellProps extends all four sub-interfaces (type-level check)
 * - The source code maintains correct interface extension
 * - Re-exports are available from barrel modules
 */

import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ChatShellProps } from "@/state/chat/shell/ChatShell.tsx";
import type {
  ShellLayoutProps,
  ShellInputProps,
  ShellDialogProps,
  ShellScrollProps,
} from "@/state/chat/shell/prop-interfaces.ts";

const SRC_ROOT = path.resolve(import.meta.dir, "../../../../src");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(SRC_ROOT, relativePath), "utf-8");
}

// ============================================================================
// Tests: Type-level structural checks
// ============================================================================

describe("ChatShellProps decomposition (type-level)", () => {
  test("sub-interfaces are assignable from ChatShellProps", () => {
    // Type-level check: ChatShellProps should be assignable to each sub-interface.
    // If any property is missing, this file won't compile.
    type AssertExtends<T, U> = T extends U ? true : false;

    const extendsLayout: AssertExtends<ChatShellProps, ShellLayoutProps> = true;
    const extendsInput: AssertExtends<ChatShellProps, ShellInputProps> = true;
    const extendsDialog: AssertExtends<ChatShellProps, ShellDialogProps> = true;
    const extendsScroll: AssertExtends<ChatShellProps, ShellScrollProps> = true;

    expect(extendsLayout).toBe(true);
    expect(extendsInput).toBe(true);
    expect(extendsDialog).toBe(true);
    expect(extendsScroll).toBe(true);
  });

  test("ChatShellProps is an intersection of all sub-interfaces", () => {
    // Verify at the type level that ChatShellProps extends all four sub-interfaces
    type Combined = ShellLayoutProps & ShellInputProps & ShellDialogProps & ShellScrollProps;
    type AssertExtends<T, U> = T extends U ? true : false;

    // ChatShellProps should extend the combined type
    const extendsCombined: AssertExtends<ChatShellProps, Combined> = true;
    expect(extendsCombined).toBe(true);
  });
});

// ============================================================================
// Tests: Source-level structural verification
// ============================================================================

describe("ChatShellProps source structure", () => {
  test("ChatShell.tsx declares ChatShellProps extending all sub-interfaces", () => {
    const source = readSource("state/chat/shell/ChatShell.tsx");

    expect(source).toContain(
      "export interface ChatShellProps extends ShellLayoutProps, ShellInputProps, ShellDialogProps, ShellScrollProps",
    );
  });

  test("ChatShell.tsx imports sub-interfaces from prop-interfaces", () => {
    const source = readSource("state/chat/shell/ChatShell.tsx");

    expect(source).toContain("ShellLayoutProps");
    expect(source).toContain("ShellInputProps");
    expect(source).toContain("ShellDialogProps");
    expect(source).toContain("ShellScrollProps");
    expect(source).toContain("./prop-interfaces.ts");
  });

  test("prop-interfaces.ts exports all four sub-interfaces", () => {
    const source = readSource("state/chat/shell/prop-interfaces.ts");

    expect(source).toContain("export interface ShellLayoutProps");
    expect(source).toContain("export interface ShellInputProps");
    expect(source).toContain("export interface ShellDialogProps");
    expect(source).toContain("export interface ShellScrollProps");
  });
});

// ============================================================================
// Tests: ShellLayoutProps expected properties
// ============================================================================

describe("ShellLayoutProps properties", () => {
  test("contains layout-related properties", () => {
    const source = readSource("state/chat/shell/prop-interfaces.ts");

    // Extract the ShellLayoutProps block
    const layoutStart = source.indexOf("export interface ShellLayoutProps");
    const layoutEnd = source.indexOf("}", layoutStart);
    const layoutBlock = source.slice(layoutStart, layoutEnd + 1);

    const expectedProps = [
      "availableModels",
      "compactionSummary",
      "displayModel",
      "isStreaming",
      "messages",
      "model",
      "themeColors",
      "tier",
      "version",
      "workingDir",
      "handleModelSelect",
      "handleModelSelectorCancel",
    ];

    for (const prop of expectedProps) {
      expect(layoutBlock).toContain(prop);
    }
  });
});

// ============================================================================
// Tests: ShellInputProps expected properties
// ============================================================================

describe("ShellInputProps properties", () => {
  test("contains input-related properties", () => {
    const source = readSource("state/chat/shell/prop-interfaces.ts");

    const inputStart = source.indexOf("export interface ShellInputProps");
    const inputEnd = source.indexOf("}", inputStart);
    const inputBlock = source.slice(inputStart, inputEnd + 1);

    const expectedProps = [
      "handleSubmit",
      "handleTextareaContentChange",
      "inputFocused",
      "textareaRef",
      "showAutocomplete",
      "autocompleteInput",
      "autocompleteSuggestions",
    ];

    for (const prop of expectedProps) {
      expect(inputBlock).toContain(prop);
    }
  });
});

// ============================================================================
// Tests: ShellDialogProps expected properties
// ============================================================================

describe("ShellDialogProps properties", () => {
  test("contains dialog-related properties", () => {
    const source = readSource("state/chat/shell/prop-interfaces.ts");

    const dialogStart = source.indexOf("export interface ShellDialogProps");
    const dialogEnd = source.indexOf("}", dialogStart);
    const dialogBlock = source.slice(dialogStart, dialogEnd + 1);

    expect(dialogBlock).toContain("activeQuestion");
    expect(dialogBlock).toContain("handleQuestionAnswer");
  });
});

// ============================================================================
// Tests: ShellScrollProps expected properties
// ============================================================================

describe("ShellScrollProps properties", () => {
  test("contains scroll-related properties", () => {
    const source = readSource("state/chat/shell/prop-interfaces.ts");

    const scrollStart = source.indexOf("export interface ShellScrollProps");
    const scrollEnd = source.indexOf("}", scrollStart);
    const scrollBlock = source.slice(scrollStart, scrollEnd + 1);

    expect(scrollBlock).toContain("scrollAcceleration");
    expect(scrollBlock).toContain("scrollboxRef");
  });
});

// ============================================================================
// Tests: Re-exports from barrel modules
// ============================================================================

describe("sub-interface re-exports", () => {
  test("types.ts re-exports sub-interfaces", () => {
    const source = readSource("state/chat/shell/types.ts");

    expect(source).toContain("ShellLayoutProps");
    expect(source).toContain("ShellInputProps");
    expect(source).toContain("ShellDialogProps");
    expect(source).toContain("ShellScrollProps");
  });

  test("index.ts re-exports sub-interfaces", () => {
    const source = readSource("state/chat/shell/index.ts");

    expect(source).toContain("ShellLayoutProps");
    expect(source).toContain("ShellInputProps");
    expect(source).toContain("ShellDialogProps");
    expect(source).toContain("ShellScrollProps");
  });
});
