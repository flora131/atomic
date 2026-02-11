# Workflow Composition Patterns

**Date:** 2026-02-03
**Status:** Documentation
**Author:** Research Agent

## Executive Summary

This document provides comprehensive documentation on workflow composition patterns in Atomic, focusing on how to compose complex workflows from simpler building blocks using the subgraph node system. It covers subgraph usage, workflow resolution by name, circular dependency detection, parent-child composition, and state passing between workflows.

---

## Table of Contents

1. [Overview](#overview)
2. [Subgraph Node Usage](#subgraph-node-usage)
3. [Referencing Workflows by Name](#referencing-workflows-by-name)
4. [Circular Dependency Detection](#circular-dependency-detection)
5. [Parent-Child Workflow Composition](#parent-child-workflow-composition)
6. [State Passing Between Workflows](#state-passing-between-workflows)
7. [Best Practices](#best-practices)
8. [Examples](#examples)

---

## Overview

Atomic provides a powerful workflow composition system that allows you to:

- **Nest workflows**: Execute a complete workflow as a single node within a parent workflow
- **Reference by name**: Resolve workflow references at runtime using string names
- **Compose hierarchically**: Build complex workflows from simpler, reusable building blocks
- **Map state**: Transform state between parent and child workflows

The key component enabling this is the `subgraphNode()` factory function in `src/graph/nodes.ts`.

---

## Subgraph Node Usage

### Basic Subgraph Node

The `subgraphNode()` factory creates a node that executes a nested workflow:

```typescript
import { subgraphNode } from "./graph/nodes.ts";
import { graph } from "./graph/builder.ts";
import type { BaseState } from "./graph/types.ts";

interface ParentState extends BaseState {
  document: string;
  analysisResults?: AnalysisResult;
}

interface ChildState extends BaseState {
  doc: string;
  results?: AnalysisResult;
}

// Create the subgraph node
const analysisNode = subgraphNode<ParentState, ChildState>({
  id: "deep-analysis",
  subgraph: compiledAnalysisGraph,  // Direct compiled graph reference
  inputMapper: (state) => ({
    doc: state.document,
    outputs: {},
    errors: [],
  }),
  outputMapper: (subState, parentState) => ({
    analysisResults: subState.results,
  }),
});
```

### Configuration Options

The `SubgraphNodeConfig` interface supports these options:

| Option | Type | Description |
|--------|------|-------------|
| `id` | `NodeId` | Unique identifier for the node |
| `subgraph` | `CompiledSubgraph<TSubState>` or `string` | The workflow to execute (direct or by name) |
| `inputMapper` | `(state: TState) => TSubState` | Transform parent state to child initial state |
| `outputMapper` | `(subState: TSubState, parentState: TState) => Partial<TState>` | Map child results to parent state update |
| `name` | `string` | Human-readable name (optional) |
| `description` | `string` | Description (optional) |

---

## Referencing Workflows by Name

Instead of passing a compiled graph directly, you can reference workflows by name:

```typescript
// Using a workflow name string
const researchNode = subgraphNode<MainState, ResearchState>({
  id: "research",
  subgraph: "research-codebase",  // Resolved at runtime
  inputMapper: (state) => ({
    topic: state.currentTopic,
    outputs: {},
    errors: [],
  }),
});
```

### How Name Resolution Works

1. **Workflow Registry**: All workflows (built-in, global, local) are registered in `workflowRegistry`
2. **Resolution Function**: `resolveWorkflowRef()` looks up workflows by name
3. **Global Resolver**: Set during initialization via `setWorkflowResolver()`

### Setting Up the Workflow Resolver

During application initialization, call `initializeWorkflowResolver()`:

```typescript
import { loadWorkflowsFromDisk, initializeWorkflowResolver } from "./ui/commands/workflow-commands.ts";

// In app initialization
await loadWorkflowsFromDisk();  // Discover custom workflows
initializeWorkflowResolver();   // Enable name resolution
```

Alternatively, use `registerWorkflowCommands()` which does both:

```typescript
import { loadWorkflowsFromDisk, registerWorkflowCommands } from "./ui/commands/workflow-commands.ts";

await loadWorkflowsFromDisk();
registerWorkflowCommands();  // Registers commands AND initializes resolver
```

### Resolution Priority

Workflows are resolved in this priority order:

1. **Local workflows** (`.atomic/workflows/`) - highest priority
2. **Global workflows** (`~/.atomic/workflows/`) - medium priority
3. **Built-in workflows** - lowest priority

---

## Circular Dependency Detection

Atomic automatically detects circular dependencies when resolving workflow references.

### How It Works

The `resolveWorkflowRef()` function maintains a `resolutionStack` Set that tracks the current resolution chain:

```typescript
const resolutionStack: Set<string> = new Set();

export function resolveWorkflowRef(name: string): CompiledGraph<BaseState> | null {
  const lowerName = name.toLowerCase();

  // Check for circular dependency
  if (resolutionStack.has(lowerName)) {
    const chain = [...resolutionStack, lowerName].join(" -> ");
    throw new Error(`Circular workflow dependency detected: ${chain}`);
  }

  // Add to resolution stack
  resolutionStack.add(lowerName);

  try {
    // Look up and create workflow...
    const metadata = getWorkflowFromRegistry(lowerName);
    if (!metadata) return null;
    return metadata.createWorkflow(config);
  } finally {
    // Always remove from stack
    resolutionStack.delete(lowerName);
  }
}
```

### Error Message Format

If Workflow A references B, and B references A, you'll see:

```
Error: Circular workflow dependency detected: a -> b -> a
```

### Avoiding Circular Dependencies

1. **Design acyclic workflows**: Plan your workflow hierarchy before implementation
2. **Use composition over extension**: Prefer composing workflows side-by-side rather than nesting deeply
3. **Extract common logic**: Move shared functionality into separate, non-circular workflows

---

## Parent-Child Workflow Composition

### Basic Composition Pattern

Create a parent workflow that orchestrates child workflows:

```typescript
import { graph } from "./graph/builder.ts";
import { subgraphNode, clearContextNode } from "./graph/nodes.ts";

// Define state interfaces
interface MainState extends BaseState {
  userRequest: string;
  researchDoc?: string;
  specDoc?: string;
  prUrl?: string;
}

interface ResearchState extends BaseState {
  topic: string;
  doc?: string;
}

interface SpecState extends BaseState {
  research: string;
  spec?: string;
}

// Create child workflow graphs
const researchGraph = graph<ResearchState>()
  .start(researchNode)
  .then(documentNode)
  .end()
  .compile();

const specGraph = graph<SpecState>()
  .start(analyzeNode)
  .then(writeSpecNode)
  .end()
  .compile();

// Compose parent workflow
const mainWorkflow = graph<MainState>()
  .start(subgraphNode<MainState, ResearchState>({
    id: "research-phase",
    subgraph: researchGraph,
    inputMapper: (s) => ({ topic: s.userRequest, outputs: {}, errors: [] }),
    outputMapper: (sub, parent) => ({ researchDoc: sub.doc }),
  }))
  .then(clearContextNode({ id: "clear-1" }))
  .then(subgraphNode<MainState, SpecState>({
    id: "spec-phase",
    subgraph: specGraph,
    inputMapper: (s) => ({ research: s.researchDoc!, outputs: {}, errors: [] }),
    outputMapper: (sub, parent) => ({ specDoc: sub.spec }),
  }))
  .end()
  .compile();
```

### Using Named References

For better modularity, use string workflow names:

```typescript
const mainWorkflow = graph<MainState>()
  .start(subgraphNode<MainState, ResearchState>({
    id: "research-phase",
    subgraph: "research-codebase",  // Name reference
    inputMapper: (s) => ({ topic: s.userRequest, outputs: {}, errors: [] }),
    outputMapper: (sub, parent) => ({ researchDoc: sub.doc }),
  }))
  .then(clearContextNode({ id: "clear-1" }))
  .then(subgraphNode<MainState, SpecState>({
    id: "spec-phase",
    subgraph: "create-spec",  // Name reference
    inputMapper: (s) => ({ research: s.researchDoc!, outputs: {}, errors: [] }),
    outputMapper: (sub, parent) => ({ specDoc: sub.spec }),
  }))
  .end()
  .compile();
```

---

## State Passing Between Workflows

### Input Mapping

The `inputMapper` function transforms parent state to child initial state:

```typescript
inputMapper: (parentState: ParentState): ChildState => {
  return {
    // Required BaseState fields
    outputs: {},
    errors: [],

    // Child-specific fields mapped from parent
    document: parentState.sourceDocument,
    options: {
      verbose: parentState.debug,
      format: parentState.outputFormat,
    },
  };
}
```

### Output Mapping

The `outputMapper` function merges child results back into parent state:

```typescript
outputMapper: (childState: ChildState, parentState: ParentState): Partial<ParentState> => {
  return {
    // Only return fields to update
    analysisResult: childState.result,
    processingTime: childState.metrics.duration,

    // Can combine with existing parent state
    logs: [...parentState.logs, ...childState.logs],
  };
}
```

### Default Behavior

If no mappers are provided:

- **Input**: Child receives parent state cast to child type (use with caution)
- **Output**: Child final state is stored in `parent.outputs[nodeId]`

```typescript
// No mappers - child state stored in outputs
const simpleSubgraph = subgraphNode<ParentState, ChildState>({
  id: "analysis",
  subgraph: analysisGraph,
  // No inputMapper or outputMapper
});

// Access result later:
// parentState.outputs["analysis"] contains full ChildState
```

### Preserving State Through Context Clears

When using `clearContextNode` between subgraphs, ensure important state is persisted:

```typescript
// State fields survive context clear (only LLM context is cleared)
const workflow = graph<MainState>()
  .start(researchSubgraph)
  .then(clearContextNode({
    id: "clear-research",
    message: (s) => `Research complete. Documented: ${s.researchDoc?.slice(0, 100)}...`
  }))
  .then(specSubgraph)  // Can access s.researchDoc
  .end()
  .compile();
```

---

## Best Practices

### 1. Design State Interfaces Carefully

Define clear boundaries between workflow states:

```typescript
// Good: Explicit interfaces with clear boundaries
interface ResearchWorkflowState extends BaseState {
  topic: string;
  findings: Finding[];
  summary?: string;
}

interface MainWorkflowState extends BaseState {
  userRequest: string;
  researchSummary?: string;  // Only what main workflow needs
}
```

### 2. Keep Subgraphs Focused

Each subgraph should have a single responsibility:

```typescript
// Good: Focused subgraphs
const researchSubgraph = /* ... research only */;
const specSubgraph = /* ... spec creation only */;
const implementSubgraph = /* ... implementation only */;

// Bad: Monolithic subgraph doing everything
const doEverythingSubgraph = /* ... */;
```

### 3. Use Name References for Flexibility

Prefer string names over direct graph references for flexibility:

```typescript
// Good: Can be overridden by local workflows
subgraph: "research-codebase"

// Less flexible: Hard-coded graph
subgraph: compiledResearchGraph
```

### 4. Handle Errors Gracefully

Child workflow errors propagate to parent. Handle them:

```typescript
const workflow = graph<MainState>()
  .start(riskySubgraph)
  .catch(errorHandlerNode)
  .end()
  .compile();
```

### 5. Document Workflow Dependencies

When creating custom workflows that reference others, document the dependencies:

```typescript
/**
 * Main workflow for feature implementation.
 *
 * Dependencies:
 * - research-codebase: Codebase analysis workflow
 * - create-spec: Specification creation workflow
 * - create-feature-list: Feature extraction workflow
 */
export default function createMainWorkflow(config?: Config) {
  // ...
}
```

---

## Examples

### Example 1: Simple Subgraph Composition

```typescript
// Child workflow for data fetching
const fetchGraph = graph<FetchState>()
  .start(fetchApiNode)
  .then(parseResponseNode)
  .end()
  .compile();

// Parent workflow using subgraph
const workflow = graph<AppState>()
  .start(initNode)
  .then(subgraphNode({
    id: "fetch-data",
    subgraph: fetchGraph,
    inputMapper: (s) => ({ url: s.apiEndpoint, outputs: {}, errors: [] }),
    outputMapper: (sub, parent) => ({ data: sub.parsedData }),
  }))
  .then(processDataNode)
  .end()
  .compile();
```

### Example 2: Conditional Subgraph Execution

```typescript
const workflow = graph<MainState>()
  .start(analyzeNode)
  .if((s) => s.needsDeepAnalysis)
    .then(subgraphNode({
      id: "deep-analysis",
      subgraph: "deep-analysis-workflow",
      inputMapper: (s) => ({ data: s.rawData, outputs: {}, errors: [] }),
    }))
  .else()
    .then(quickAnalysisNode)
  .endif()
  .then(reportNode)
  .end()
  .compile();
```

### Example 3: Loop with Subgraph

```typescript
const workflow = graph<IterativeState>()
  .start(initNode)
  .loop(
    subgraphNode({
      id: "process-item",
      subgraph: "item-processor",
      inputMapper: (s) => ({ item: s.items[s.currentIndex], outputs: {}, errors: [] }),
      outputMapper: (sub, parent) => ({
        results: [...parent.results, sub.result],
        currentIndex: parent.currentIndex + 1,
      }),
    }),
    { until: (s) => s.currentIndex >= s.items.length }
  )
  .then(aggregateNode)
  .end()
  .compile();
```

### Example 4: Parallel Subgraphs

```typescript
const workflow = graph<ParallelState>()
  .start(splitNode)
  .parallel({
    branches: ["branch-a", "branch-b", "branch-c"],
    strategy: "all",
  })
  .then(mergeNode)
  .end()
  .compile();

// Where each branch is defined as a separate node that can be a subgraph
```

---

## API Reference

### `subgraphNode<TState, TSubState>(config)`

Creates a node that executes a nested workflow.

**Type Parameters:**
- `TState` - Parent workflow state type
- `TSubState` - Child workflow state type

**Parameters:**
- `config.id` - Unique node identifier
- `config.subgraph` - Compiled graph or workflow name string
- `config.inputMapper` - (optional) Map parent state to child state
- `config.outputMapper` - (optional) Map child result to parent state update
- `config.name` - (optional) Human-readable name
- `config.description` - (optional) Description

**Returns:** `NodeDefinition<TState>`

### `setWorkflowResolver(resolver)`

Set the global workflow resolver function.

**Parameters:**
- `resolver` - Function `(name: string) => CompiledSubgraph | null`

### `resolveWorkflowRef(name)`

Resolve a workflow by name from the registry.

**Parameters:**
- `name` - Workflow name or alias (case-insensitive)

**Returns:** `CompiledGraph<BaseState> | null`

**Throws:** `Error` if circular dependency detected

---

## Related Documentation

- `src/graph/nodes.ts` - Node factory functions including `subgraphNode`
- `src/graph/builder.ts` - Graph builder fluent API
- `src/ui/commands/workflow-commands.ts` - Workflow registry and resolution
- `src/graph/types.ts` - Type definitions for graphs and nodes
