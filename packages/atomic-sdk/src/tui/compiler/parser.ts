/**
 * React-tree → tmux format-string compiler. Port of better-tmux's
 * `Parser.res`, adapted to walk React elements directly instead of
 * the ReScript Element/TextElement ADT.
 *
 * Supported nodes:
 *   - <Box> / <Text>            → `#[styles]<padding><children><padding>`
 *   - Function components       → called with their props, recursed
 *   - <Fragment>                → flatten children
 *   - string / number           → literal output
 *   - boolean / null / undefined → empty (matches React semantics)
 *   - arrays                    → joined children
 *
 * Hooks (useState, useEffect, useContext, useRef) are intentionally
 * unsupported. Footer content is static, compiled once. If a widget
 * needs reactive data, it should embed a `#{@atomic-<id>}` reference
 * via the upcoming DynamicText escape hatch and have the orchestrator
 * push values via `setStatuslineState`.
 */

import {
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { Box, Text } from "../components.tsx";
import type { ElementProps, StyleProps } from "../types.ts";
import { inlineStyle } from "./styles.ts";

function spacing(n: number | undefined): string {
  if (!n || n <= 0) return "";
  return " ".repeat(n);
}

function padding(props: StyleProps): [string, string] {
  if (props.padding !== undefined) {
    const s = spacing(props.padding);
    return [s, s];
  }
  return [spacing(props.paddingLeft), spacing(props.paddingRight)];
}

function isBoxOrText(element: ReactElement): boolean {
  return element.type === Box || element.type === Text;
}

function compileElement(props: ElementProps): string {
  const [left, right] = padding(props);
  const styles = inlineStyle(props);
  const gap = spacing(props.gap);

  const childArray = flattenChildren(props.children);
  const compiledChildren = childArray
    .map((child) => compile(child))
    .filter((s) => s !== "")
    .join(gap === "" ? "" : `${styles}${gap}`);

  return `${styles}${left}${compiledChildren}${right}`;
}

function flattenChildren(children: ReactNode): ReactNode[] {
  if (children === undefined || children === null) return [];
  if (Array.isArray(children)) return children.flatMap(flattenChildren);
  return [children];
}

/** Compile a React tree to a tmux format string. */
export function compile(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) {
    return node.map(compile).join("");
  }
  if (!isValidElement(node)) return "";

  const element = node as ReactElement;
  const { type, props } = element;

  if (isBoxOrText(element)) {
    return compileElement(props as ElementProps);
  }
  if (type === Fragment) {
    return compile((props as { children?: ReactNode }).children);
  }
  if (typeof type === "function") {
    // Function components are called directly. They must not call hooks
    // (no React render context exists). See module docstring.
    const rendered = (type as (p: unknown) => ReactNode)(props);
    return compile(rendered);
  }

  return "";
}
