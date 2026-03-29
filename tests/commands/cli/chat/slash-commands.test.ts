/**
 * Tests for slash command parsing and handling utilities in slash-commands.ts
 */
import { describe, expect, test } from "bun:test";
import {
  isSlashCommand,
  parseSlashCommand,
  handleThemeCommand,
} from "@/commands/cli/chat/slash-commands.ts";

describe("isSlashCommand", () => {
  test("returns true when message starts with '/'", () => {
    expect(isSlashCommand("/")).toBe(true);
  });

  test("returns true for '/help'", () => {
    expect(isSlashCommand("/help")).toBe(true);
  });

  test("returns true for '/theme dark'", () => {
    expect(isSlashCommand("/theme dark")).toBe(true);
  });

  test("returns false for empty string", () => {
    expect(isSlashCommand("")).toBe(false);
  });

  test("returns false when message does not start with '/'", () => {
    expect(isSlashCommand("help")).toBe(false);
  });

  test("returns false for regular text containing a slash", () => {
    expect(isSlashCommand("hello /world")).toBe(false);
  });

  test("returns false for whitespace-prefixed slash", () => {
    expect(isSlashCommand(" /help")).toBe(false);
  });

  test("returns true for slash followed by spaces", () => {
    expect(isSlashCommand("/   ")).toBe(true);
  });

  test("returns true for slash with special characters", () => {
    expect(isSlashCommand("/!@#$")).toBe(true);
  });
});

describe("parseSlashCommand", () => {
  test("parses '/help' into command 'help' with empty args", () => {
    const result = parseSlashCommand("/help");
    expect(result).toEqual({ command: "help", args: "" });
  });

  test("parses '/theme dark' into command 'theme' with args 'dark'", () => {
    const result = parseSlashCommand("/theme dark");
    expect(result).toEqual({ command: "theme", args: "dark" });
  });

  test("lowercases the command from '/HELP'", () => {
    const result = parseSlashCommand("/HELP");
    expect(result).toEqual({ command: "help", args: "" });
  });

  test("lowercases mixed-case command '/ThEmE dark'", () => {
    const result = parseSlashCommand("/ThEmE dark");
    expect(result).toEqual({ command: "theme", args: "dark" });
  });

  test("does not lowercase the args", () => {
    const result = parseSlashCommand("/echo Hello World");
    expect(result).toEqual({ command: "echo", args: "Hello World" });
  });

  test("preserves multiple args as a single string", () => {
    const result = parseSlashCommand("/model arg1 arg2");
    expect(result).toEqual({ command: "model", args: "arg1 arg2" });
  });

  test("handles extra spaces between command and args", () => {
    const result = parseSlashCommand("/model  arg1 arg2");
    expect(result).toEqual({ command: "model", args: "arg1 arg2" });
  });

  test("handles leading spaces after slash", () => {
    const result = parseSlashCommand("/  help");
    // slice(1) removes '/', trim() removes leading spaces, so 'help' is the command
    expect(result).toEqual({ command: "help", args: "" });
  });

  test("handles tab as whitespace separator between command and args", () => {
    const result = parseSlashCommand("/theme\tdark");
    expect(result).toEqual({ command: "theme", args: "dark" });
  });

  test("handles tab within args", () => {
    const result = parseSlashCommand("/cmd arg1\targ2");
    expect(result).toEqual({ command: "cmd", args: "arg1\targ2" });
  });

  test("trims trailing whitespace in args", () => {
    const result = parseSlashCommand("/theme dark   ");
    expect(result).toEqual({ command: "theme", args: "dark" });
  });

  test("parses '/' alone into empty command with empty args", () => {
    const result = parseSlashCommand("/");
    expect(result).toEqual({ command: "", args: "" });
  });

  test("parses '/   ' (slash with only spaces) into empty command", () => {
    const result = parseSlashCommand("/   ");
    expect(result).toEqual({ command: "", args: "" });
  });

  test("handles command with numeric name", () => {
    const result = parseSlashCommand("/123 foo");
    expect(result).toEqual({ command: "123", args: "foo" });
  });

  test("handles args with special characters", () => {
    const result = parseSlashCommand("/cmd hello@world#2024");
    expect(result).toEqual({ command: "cmd", args: "hello@world#2024" });
  });
});

describe("handleThemeCommand", () => {
  test("returns dark theme for 'dark'", () => {
    const result = handleThemeCommand("dark");
    expect(result).toEqual({
      newTheme: "dark",
      message: "Theme switched to dark mode.",
    });
  });

  test("returns light theme for 'light'", () => {
    const result = handleThemeCommand("light");
    expect(result).toEqual({
      newTheme: "light",
      message: "Theme switched to light mode.",
    });
  });

  test("handles uppercase 'DARK' (case-insensitive)", () => {
    const result = handleThemeCommand("DARK");
    expect(result).toEqual({
      newTheme: "dark",
      message: "Theme switched to dark mode.",
    });
  });

  test("handles uppercase 'LIGHT' (case-insensitive)", () => {
    const result = handleThemeCommand("LIGHT");
    expect(result).toEqual({
      newTheme: "light",
      message: "Theme switched to light mode.",
    });
  });

  test("handles mixed-case 'DaRk'", () => {
    const result = handleThemeCommand("DaRk");
    expect(result).toEqual({
      newTheme: "dark",
      message: "Theme switched to dark mode.",
    });
  });

  test("returns null for unsupported theme 'blue'", () => {
    const result = handleThemeCommand("blue");
    expect(result).toBeNull();
  });

  test("returns null for empty string", () => {
    const result = handleThemeCommand("");
    expect(result).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    const result = handleThemeCommand("   ");
    expect(result).toBeNull();
  });

  test("returns null for 'dark ' with trailing space (not trimmed by caller)", () => {
    // handleThemeCommand does toLowerCase but not trim, so 'dark ' !== 'dark'
    const result = handleThemeCommand("dark ");
    expect(result).toBeNull();
  });

  test("returns null for unrelated string 'solarized'", () => {
    const result = handleThemeCommand("solarized");
    expect(result).toBeNull();
  });
});
