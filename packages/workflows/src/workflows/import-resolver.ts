/**
 * Workflow import resolution and import graph validation.
 *
 * Imports are regular TypeScript module imports: workflow authors import a
 * compiled WorkflowDefinition and pass it to defineWorkflow(...).import(...).
 * The builder stores direct child definitions, so resolution does not perform
 * registry-name or path lookups.
 */

import type {
  WorkflowDefinition,
  WorkflowImportDeclaration,
} from "../shared/types.js";
import { validateWorkflowDefinitionShape } from "../extension/workflow-module-loader.js";
import type { WorkflowRegistry } from "./registry.js";

export type WorkflowImportDiagnosticCode = "IMPORT_UNRESOLVED" | "IMPORT_CIRCULAR" | "IMPORT_INVALID";

export interface WorkflowImportDiagnostic {
  readonly level: "error";
  readonly code: WorkflowImportDiagnosticCode;
  readonly message: string;
  readonly source?: string;
  readonly workflow?: string;
  readonly alias?: string;
  readonly chain?: readonly string[];
}

export interface WorkflowSourceReference {
  readonly id: string;
  readonly filePath?: string;
}

export interface WorkflowImportResolverOptions {
  readonly registry: WorkflowRegistry;
  readonly cwd?: string;
  readonly sources?: readonly WorkflowSourceReference[];
}

export interface WorkflowImportGraphValidationOptions extends WorkflowImportResolverOptions {
  readonly roots?: readonly WorkflowDefinition[];
}

export interface ResolvedWorkflowImport {
  readonly alias: string;
  readonly declaration: WorkflowImportDeclaration;
  readonly definition: WorkflowDefinition;
  readonly identity: string;
  readonly label: string;
}

export type WorkflowImportResolution =
  | { readonly ok: true; readonly resolved: ResolvedWorkflowImport }
  | { readonly ok: false; readonly diagnostic: WorkflowImportDiagnostic };

type ImportDeclarationResolution =
  | { readonly ok: true; readonly declaration: WorkflowImportDeclaration }
  | { readonly ok: false; readonly diagnostic: WorkflowImportDiagnostic };

interface StackNode {
  readonly identity: string;
  readonly label: string;
}

function hasOwnRecordKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidWorkflowDefinition(value: unknown): value is WorkflowDefinition {
  return validateWorkflowDefinitionShape(value) === null;
}

function invalidDiagnostic(
  parent: WorkflowDefinition,
  alias: string,
  message: string,
  source?: string,
): WorkflowImportDiagnostic {
  return {
    level: "error",
    code: "IMPORT_INVALID",
    workflow: parent.normalizedName,
    alias,
    message: `Workflow "${parent.name}" import "${alias}" is invalid: ${message}`,
    ...(source !== undefined ? { source } : {}),
  };
}

function unresolvedDiagnostic(
  parent: WorkflowDefinition,
  alias: string,
  message: string,
  source?: string,
): WorkflowImportDiagnostic {
  return {
    level: "error",
    code: "IMPORT_UNRESOLVED",
    workflow: parent.normalizedName,
    alias,
    message: `Workflow "${parent.name}" import "${alias}" could not be resolved: ${message}`,
    ...(source !== undefined ? { source } : {}),
  };
}

function workflowIdentity(definition: WorkflowDefinition): string {
  return `workflow:${definition.normalizedName}`;
}

function declarationForAlias(
  parent: WorkflowDefinition,
  alias: string,
): ImportDeclarationResolution {
  const declaration = parent.imports?.[alias];
  if (declaration === undefined) {
    return {
      ok: false,
      diagnostic: unresolvedDiagnostic(parent, alias, `alias is not declared on workflow "${parent.name}"`),
    };
  }
  if (!isRecord(declaration)) {
    return { ok: false, diagnostic: invalidDiagnostic(parent, alias, "declaration must be an object") };
  }
  const definition = declaration["definition"];
  if (!isValidWorkflowDefinition(definition)) {
    return { ok: false, diagnostic: invalidDiagnostic(parent, alias, "definition must be a compiled workflow definition") };
  }
  if (declaration["description"] !== undefined && typeof declaration["description"] !== "string") {
    return { ok: false, diagnostic: invalidDiagnostic(parent, alias, "description must be a string when provided") };
  }
  return {
    ok: true,
    declaration: {
      definition,
      ...(typeof declaration["description"] === "string" ? { description: declaration["description"] } : {}),
    },
  };
}

function resolveDeclaredImport(
  alias: string,
  declaration: WorkflowImportDeclaration,
): WorkflowImportResolution {
  const child = declaration.definition;
  const identity = workflowIdentity(child);
  return {
    ok: true,
    resolved: {
      alias,
      declaration,
      definition: child,
      identity,
      label: child.normalizedName,
    },
  };
}

function importDeclarations(definition: WorkflowDefinition): readonly [string, unknown][] {
  const imports = definition.imports;
  if (imports === undefined || !isRecord(imports)) return [];
  return Object.entries(imports);
}

function circularDiagnostic(stack: readonly StackNode[], repeated: StackNode): WorkflowImportDiagnostic {
  const start = stack.findIndex((node) => node.identity === repeated.identity);
  const cycle = [...stack.slice(Math.max(0, start)), repeated].map((node) => node.label);
  return {
    level: "error",
    code: "IMPORT_CIRCULAR",
    message: `Circular workflow import detected: ${cycle.join(" -> ")}`,
    source: cycle.join(" -> "),
    workflow: repeated.label,
    chain: Object.freeze(cycle),
  };
}

function diagnosticKey(diagnostic: WorkflowImportDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.workflow ?? "",
    diagnostic.alias ?? "",
    diagnostic.source ?? "",
    diagnostic.message,
  ]);
}

function pushDiagnostic(
  diagnostics: WorkflowImportDiagnostic[],
  seen: Set<string>,
  diagnostic: WorkflowImportDiagnostic,
): void {
  const key = diagnosticKey(diagnostic);
  if (seen.has(key)) return;
  seen.add(key);
  diagnostics.push(diagnostic);
}

export function resolveWorkflowImport(
  parent: WorkflowDefinition,
  alias: string,
  _options: WorkflowImportResolverOptions,
): WorkflowImportResolution {
  const declaration = declarationForAlias(parent, alias);
  if (!declaration.ok) return declaration;
  return resolveDeclaredImport(alias, declaration.declaration);
}

export function validateWorkflowImportGraph(
  options: WorkflowImportGraphValidationOptions,
): WorkflowImportDiagnostic[] {
  const diagnostics: WorkflowImportDiagnostic[] = [];
  const seenDiagnostics = new Set<string>();
  const visited = new Set<string>();
  const roots = options.roots ?? options.registry.all();

  const visit = (definition: WorkflowDefinition, identity: string, label: string, stack: readonly StackNode[]): void => {
    const repeated = stack.find((node) => node.identity === identity);
    if (repeated !== undefined) {
      pushDiagnostic(diagnostics, seenDiagnostics, circularDiagnostic(stack, { identity, label }));
      return;
    }
    if (visited.has(identity)) return;

    const nextStack = [...stack, { identity, label }];
    if (definition.imports !== undefined && !isRecord(definition.imports)) {
      pushDiagnostic(diagnostics, seenDiagnostics, invalidDiagnostic(definition, "imports", "imports must be an object map"));
      visited.add(identity);
      return;
    }
    for (const [alias, rawDeclaration] of importDeclarations(definition)) {
      if (!isRecord(rawDeclaration)) {
        pushDiagnostic(diagnostics, seenDiagnostics, invalidDiagnostic(definition, alias, "declaration must be an object"));
        continue;
      }
      const childDefinition = rawDeclaration["definition"];
      if (!isValidWorkflowDefinition(childDefinition)) {
        pushDiagnostic(diagnostics, seenDiagnostics, invalidDiagnostic(definition, alias, "definition must be a compiled workflow definition"));
        continue;
      }
      if (rawDeclaration["description"] !== undefined && typeof rawDeclaration["description"] !== "string") {
        pushDiagnostic(diagnostics, seenDiagnostics, invalidDiagnostic(definition, alias, "description must be a string when provided"));
        continue;
      }
      const declaration: WorkflowImportDeclaration = {
        definition: childDefinition,
        ...(typeof rawDeclaration["description"] === "string" ? { description: rawDeclaration["description"] } : {}),
      };
      const resolved = resolveDeclaredImport(alias, declaration);
      if (!resolved.ok) {
        pushDiagnostic(diagnostics, seenDiagnostics, resolved.diagnostic);
        continue;
      }
      visit(
        resolved.resolved.definition,
        resolved.resolved.identity,
        resolved.resolved.label,
        nextStack,
      );
    }

    visited.add(identity);
  };

  for (const root of roots) {
    visit(root, workflowIdentity(root), root.normalizedName, []);
  }

  return diagnostics;
}

export function formatWorkflowImportDiagnostics(diagnostics: readonly WorkflowImportDiagnostic[]): string {
  return diagnostics.map((diagnostic) => `  - ${diagnostic.code}: ${diagnostic.message}`).join("\n");
}

export function workflowImportSourceSummary(declaration: WorkflowImportDeclaration): string {
  return `definition:${declaration.definition.normalizedName}`;
}
