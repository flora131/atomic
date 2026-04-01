import ts from "typescript";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import type { StageContext } from "@/services/workflows/conductor/types.ts";
import type {
  StageOptions,
  ToolOptions,
  AskUserQuestionOptions,
} from "@/services/workflows/dsl/types.ts";

const BASE_STATE_FIELDS = new Set(["executionId", "lastUpdated", "outputs"]);

interface StateTracker {
  readonly proxy: BaseState;
  readonly accessed: Set<string>;
}

export function createStateTracker(): StateTracker {
  const accessed = new Set<string>();
  const proxy = new Proxy({} as BaseState, {
    get(_target, prop, _receiver) {
      if (typeof prop === "string") {
        accessed.add(prop);
      }
      return "";
    },
    has(_target, prop) {
      if (typeof prop === "string") {
        accessed.add(prop);
      }
      return true;
    },
  });
  return { proxy, accessed };
}

function filterUserFields(accessed: Set<string>): string[] {
  return [...accessed].filter((f) => !BASE_STATE_FIELDS.has(f));
}

export function inferStageOutputs(outputMapper: StageOptions["outputMapper"]): string[] {
  try {
    const result = outputMapper("");
    return Object.keys(result);
  } catch { return []; }
}

export function inferStageReads(prompt: StageOptions["prompt"]): string[] {
  const tracker = createStateTracker();
  const ctx: StageContext = {
    userPrompt: "",
    stageOutputs: new Map(),
    tasks: [],
    abortSignal: new AbortController().signal,
    state: tracker.proxy,
  };
  try { prompt(ctx); } catch {}
  return filterUserFields(tracker.accessed);
}

export function inferAskUserOutputs(outputMapper: AskUserQuestionOptions["outputMapper"]): string[] {
  if (!outputMapper) return [];
  try {
    const result = outputMapper("");
    return Object.keys(result);
  } catch { return []; }
}

export function inferAskUserReads(question: AskUserQuestionOptions["question"]): string[] {
  if (typeof question !== "function") return [];
  const tracker = createStateTracker();
  try { question(tracker.proxy); } catch {}
  return filterUserFields(tracker.accessed);
}

/**
 * Strips type assertions (`as T`), angle-bracket casts (`<T>`), parentheses,
 * and non-null assertions (`!`) to reach the underlying expression.
 */
function unwrapTypeCasts(node: ts.Node): ts.Node {
  let current = node;
  while (true) {
    if (ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current)) {
      current = current.expression;
    } else if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/**
 * Infers which state fields a tool's `execute` function reads by parsing the
 * function source with the TypeScript compiler API and walking the AST.
 *
 * ### Why AST instead of execution?
 * Unlike `inferStageReads` (which safely runs prompt builders through a Proxy),
 * tool `execute` functions can trigger side effects (network calls, file I/O,
 * console output). Static source analysis avoids executing the function body.
 *
 * ### Why AST over regex?
 * The TypeScript AST correctly handles type casts (`as unknown as Record<…>`),
 * optional chaining (`state?.field`), bracket access (`state["field"]`), and
 * destructuring with renames — all of which are fragile or impossible with
 * regex patterns.
 *
 * ### Known limitations
 * - Fully dynamic property access (`state[someVariable]`) cannot be resolved
 *   statically.
 * - Minified / bundled `Function.prototype.toString()` output may not parse.
 */
export function inferToolReads(execute: ToolOptions["execute"]): string[] {
  try {
    const source = execute.toString();
    // Wrap as a variable declaration so the parser accepts any function form
    // (arrow, async, named) as a valid statement.
    const sourceFile = ts.createSourceFile(
      "infer.ts",
      `const __fn = ${source};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const accessed = new Set<string>();
    const stateAliases = new Set<string>();

    /** Returns true when `node` resolves to a `.state` reference or a known alias. */
    function isStateNode(node: ts.Node): boolean {
      const inner = unwrapTypeCasts(node);
      if (ts.isPropertyAccessExpression(inner) && inner.name.text === "state") {
        return true;
      }
      return ts.isIdentifier(inner) && stateAliases.has(inner.text);
    }

    function visit(node: ts.Node): void {
      // 1. Dot access: state.fieldName  (handles optional chaining & casts)
      if (ts.isPropertyAccessExpression(node) && isStateNode(node.expression)) {
        accessed.add(node.name.text);
      }

      // 2. Bracket access: state["fieldName"]
      if (
        ts.isElementAccessExpression(node) &&
        isStateNode(node.expression) &&
        ts.isStringLiteral(node.argumentExpression)
      ) {
        accessed.add(node.argumentExpression.text);
      }

      // 3. Variable declarations — detect aliases and destructuring from state
      if (ts.isVariableDeclaration(node) && node.initializer && isStateNode(node.initializer)) {
        if (ts.isIdentifier(node.name)) {
          // Alias: const s = ctx.state
          stateAliases.add(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          // Destructuring: const { plan, feedback } = ctx.state
          for (const element of node.name.elements) {
            if (!ts.isBindingElement(element)) continue;
            // Handle renames: { original: renamed } — track the original name
            const fieldName = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name)
                ? element.name.text
                : undefined;
            if (fieldName) accessed.add(fieldName);
          }
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return filterUserFields(accessed);
  } catch {
    return [];
  }
}

export function inferToolOutputs(outputMapper: ToolOptions["outputMapper"], execute?: ToolOptions["execute"]): string[] {
  if (outputMapper) {
    try {
      const result = outputMapper({});
      return Object.keys(result);
    } catch { return []; }
  }
  // No outputMapper — the execute return value IS the state update.
  // Use AST analysis to find the top-level object literal keys in return statements.
  if (execute) {
    return inferExecuteReturnKeys(execute);
  }
  return [];
}

/**
 * Infers which state fields a tool's `execute` function writes by parsing
 * the function source and finding the keys of returned object literals.
 *
 * Handles: `return { key1: val, key2: val }`, arrow functions with implicit
 * return `async (ctx) => ({ key: val })`, and conditional returns.
 */
function inferExecuteReturnKeys(execute: ToolOptions["execute"]): string[] {
  try {
    const source = execute.toString();
    const sourceFile = ts.createSourceFile(
      "infer-outputs.ts",
      `const __fn = ${source};`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    const keys = new Set<string>();

    function extractObjectLiteralKeys(node: ts.Node): void {
      const unwrapped = unwrapTypeCasts(node);
      if (ts.isObjectLiteralExpression(unwrapped)) {
        for (const prop of unwrapped.properties) {
          if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
            const name = prop.name;
            if (ts.isIdentifier(name)) {
              keys.add(name.text);
            } else if (ts.isStringLiteral(name)) {
              keys.add(name.text);
            }
          }
          if (ts.isSpreadAssignment(prop)) {
            // Cannot statically resolve spread — skip
          }
        }
      }
    }

    function visit(node: ts.Node): void {
      // Explicit return: return { key: value }
      if (ts.isReturnStatement(node) && node.expression) {
        extractObjectLiteralKeys(node.expression);
      }
      // Arrow function with expression body (implicit return):
      // (ctx) => ({ key: value })
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        extractObjectLiteralKeys(node.body);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return [...keys].filter((k) => !BASE_STATE_FIELDS.has(k));
  } catch {
    return [];
  }
}

export interface InferredMetadata { reads: string[]; outputs: string[]; }

export function inferStageMetadata(config: StageOptions): InferredMetadata {
  return {
    reads: inferStageReads(config.prompt),
    outputs: inferStageOutputs(config.outputMapper),
  };
}

export function inferAskUserMetadata(config: AskUserQuestionOptions): InferredMetadata {
  return {
    reads: inferAskUserReads(config.question),
    outputs: inferAskUserOutputs(config.outputMapper),
  };
}

export function inferToolMetadata(config: ToolOptions): InferredMetadata {
  return {
    reads: inferToolReads(config.execute),
    outputs: inferToolOutputs(config.outputMapper, config.execute),
  };
}
