import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs"
import { join } from "path"

/**
 * Ralph Wiggum Plugin for OpenCode
 *
 * Implementation of the Ralph Wiggum technique - continuous self-referential AI loops
 * for iterative development. Named after Ralph Wiggum from The Simpsons, embodying
 * the philosophy of persistent iteration despite setbacks.
 *
 * Core concept: Feed the same prompt repeatedly, letting the AI see its previous work
 * in files and git history, creating a self-referential feedback loop.
 *
 * Based on: https://ghuntley.com/ralph/
 */

interface RalphState {
  active: boolean
  iteration: number
  maxIterations: number
  completionPromise: string | null
  featureListPath: string
  startedAt: string
  prompt: string
}

interface Feature {
  category: string
  description: string
  steps: string[]
  passes: boolean
}

// Default values - keep in sync with plugins/ralph/scripts/setup-ralph-loop.sh
const STATE_FILE = ".opencode/ralph-loop.local.md"
const DEFAULT_MAX_ITERATIONS = 0
const DEFAULT_COMPLETION_PROMISE = null
const DEFAULT_FEATURE_LIST_PATH = "research/feature-list.json"
const DEFAULT_PROMPT = `You are tasked with implementing a SINGLE feature from the \`research/feature-list.json\` file.

# Getting up to speed

1. Run \`pwd\` to see the directory you're working in. Only make edits within the current git repository.
2. Read the git logs and progress files (\`research/progress.txt\`) to get up to speed on what was recently worked on.
3. Read the \`research/feature-list.json\` file and choose the highest-priority features that's not yet done to work on.

# Typical Workflow

## Initialization

A typical workflow will start something like this:

\`\`\`
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - research/progress.txt>
[Tool Use] <read - research/feature-list.json>
[Assistant] Let me check the git log to see recent work.
[Tool Use] <bash - git log --oneline -20>
[Assistant] Now let me check if there's an init.sh script to restart the servers.
<Starts the development server>
[Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
<Tests basic functionality>
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
\`\`\`

## Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

### Testing Anti-Patterns

Use your testing-anti-patterns skill to avoid common pitfalls when writing tests.

## Design Principles

### Feature Implementation Guide: Managing Complexity

Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

**1. Apply Core Principles (The Axioms)**
* **SOLID:** Adhere strictly to these, specifically **Single Responsibility** (a class should have only one reason to change) and **Dependency Inversion** (depend on abstractions/interfaces, not concrete details).
* **Pragmatism:** Follow **KISS** (Keep It Simple) and **YAGNI** (You Aren't Gonna Need It). Do not build generic frameworks for hypothetical future requirements.

**2. Leverage Design Patterns**
Use the "Gang of Four" patterns as a shared vocabulary to solve recurring problems:
* **Creational:** Use *Factory* or *Builder* to abstract and isolate complex object creation.
* **Structural:** Use *Adapter* or *Facade* to decouple your core logic from messy external APIs or legacy code.
* **Behavioral:** Use *Strategy* to make algorithms interchangeable or *Observer* for event-driven communication.

**3. Architectural Hygiene**
* **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI).
* **Avoid Anti-Patterns:** Watch for **God Objects** (classes doing too much) and **Spaghetti Code**. If you see them, refactor using polymorphism.

**Goal:** Create "seams" in your software using interfaces. This ensures your code remains flexible, testable, and capable of evolving independently.

## Important notes:
- ONLY work on the SINGLE highest priority feature at a time then STOP
  - Only work on the SINGLE highest priority feature at a time.
  - Use the \`research/feature-list.json\` file if it is provided to you as a guide otherwise create your own \`feature-list.json\` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
- Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits
- Tip: You may run into errors while implementing the feature. ALWAYS delegate to the debugger agent using the Task tool (you can ask it to navigate the web to find best practices for the latest version) and follow the guidelines there to create a debug report
    - AFTER the debug report is generated by the debugger agent follow these steps IN ORDER:
      1. First, add a new feature to \`research/feature-list.json\` with the highest priority to fix the bug and set its \`passes\` field to \`false\`
      2. Second, append the debug report to \`research/progress.txt\` for future reference
      3. Lastly, IMMEDIATELY STOP working on the current feature and EXIT
- You may be tempted to ignore unrelated errors that you introduced or were pre-existing before you started working on the feature. DO NOT IGNORE THEM. If you need to adjust priority, do so by updating the \`research/feature-list.json\` (move the fix to the top) and \`research/progress.txt\` file to reflect the new priorities
- IF at ANY point MORE THAN 60% of your context window is filled, STOP
- AFTER implementing the feature AND verifying its functionality by creating tests, update the \`passes\` field to \`true\` for that feature in \`research/feature-list.json\`
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages by running the \`/commit\` command using the \`SlashCommand\` tool
- Write summaries of your progress in \`research/progress.txt\`
    - Tip: this can be useful to revert bad code changes and recover working states of the codebase
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.`

function parseRalphState(directory: string): RalphState | null {
  const statePath = join(directory, STATE_FILE)

  if (!existsSync(statePath)) {
    return null
  }

  try {
    // Normalize line endings to LF for cross-platform compatibility
    const content = readFileSync(statePath, "utf-8").replace(/\r\n/g, "\n")

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (!frontmatterMatch) {
      return null
    }

    const [, frontmatter, prompt] = frontmatterMatch

    // Parse frontmatter values
    const getValue = (key: string): string | null => {
      const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"))
      if (!match) return null
      // Remove surrounding quotes if present
      return match[1].replace(/^["'](.*)["']$/, "$1")
    }

    const active = getValue("active") === "true"
    const iteration = parseInt(getValue("iteration") || "1", 10)
    const maxIterations = parseInt(getValue("max_iterations") || String(DEFAULT_MAX_ITERATIONS), 10)
    const completionPromise = getValue("completion_promise")
    const featureListPath = getValue("feature_list_path") || DEFAULT_FEATURE_LIST_PATH
    const startedAt = getValue("started_at") || new Date().toISOString()

    return {
      active,
      iteration,
      maxIterations,
      completionPromise:
        completionPromise === "null" || !completionPromise
          ? DEFAULT_COMPLETION_PROMISE
          : completionPromise,
      featureListPath,
      startedAt,
      prompt: prompt.trim() || DEFAULT_PROMPT,
    }
  } catch {
    return null
  }
}

function writeRalphState(directory: string, state: RalphState): void {
  const statePath = join(directory, STATE_FILE)

  const completionPromiseYaml =
    state.completionPromise === null ? "null" : `"${state.completionPromise}"`

  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${completionPromiseYaml}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`

  writeFileSync(statePath, content, "utf-8")
}

function deleteRalphState(directory: string): boolean {
  const statePath = join(directory, STATE_FILE)

  if (existsSync(statePath)) {
    unlinkSync(statePath)
    return true
  }
  return false
}

/**
 * Check if all features in feature-list.json are passing
 * Returns { allPassing: boolean, total: number, passing: number, failing: number }
 */
function checkAllFeaturesPassing(
  directory: string,
  featureListPath: string
): { allPassing: boolean; total: number; passing: number; failing: number } | null {
  const fullPath = join(directory, featureListPath)

  if (!existsSync(fullPath)) {
    return null
  }

  try {
    const content = readFileSync(fullPath, "utf-8")
    const features: Feature[] = JSON.parse(content)

    if (!Array.isArray(features) || features.length === 0) {
      return null
    }

    const total = features.length
    const passing = features.filter((f) => f.passes === true).length
    const failing = total - passing

    return {
      allPassing: failing === 0,
      total,
      passing,
      failing,
    }
  } catch {
    return null
  }
}

function checkCompletionPromise(text: string, promise: string): boolean {
  // Extract text from <promise> tags
  const promiseMatch = text.match(/<promise>([\s\S]*?)<\/promise>/)
  if (!promiseMatch) return false

  // Normalize whitespace and compare
  const promiseText = promiseMatch[1].trim().replace(/\s+/g, " ")
  return promiseText === promise
}

export const RalphPlugin: Plugin = async ({ directory, client, $ }) => {
  return {
    /**
     * Handle session idle event - this is when the AI has finished responding
     * and would normally wait for user input. In Ralph mode, we intercept this
     * to continue the loop.
     */
    event: async ({ event }) => {
      // Use session.status event (session.idle is deprecated)
      if (event.type !== "session.status") return
      if (event.properties.status?.type !== "idle") return

      const state = parseRalphState(directory)
      if (!state || !state.active) return

      // Get the last assistant message to check for completion
      // We need to check if the completion promise was output
      if (state.completionPromise) {
        try {
          // Use the SDK to get session messages
          const response = await client.session.messages({
            path: { id: event.properties.sessionID },
          })
          const messages = response.data
          if (messages && messages.length > 0) {
            // Find the last assistant message
            const lastAssistantMsg = [...messages]
              .reverse()
              .find((m) => m.info.role === "assistant")

            if (lastAssistantMsg) {
              // Extract text content from message parts
              const textContent = lastAssistantMsg.parts
                ?.filter((p: { type: string }) => p.type === "text")
                .map((p: { type: string; text?: string }) => p.text ?? "")
                .join("\n")

              if (textContent && checkCompletionPromise(textContent, state.completionPromise)) {
                // Completion promise detected - stop the loop
                deleteRalphState(directory)
                await client.app.log({
                  body: {
                    service: "ralph-plugin",
                    level: "info",
                    message: `Ralph loop completed: detected <promise>${state.completionPromise}</promise>`,
                  },
                })
                return
              }
            }
          }
        } catch (err) {
          // If we can't check messages, continue the loop
          await client.app.log({
            body: {
              service: "ralph-plugin",
              level: "warn",
              message: `Could not check for completion promise: ${err}`,
            },
          })
        }
      }

      // Check max iterations
      if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
        deleteRalphState(directory)
        await client.app.log({
          body: {
            service: "ralph-plugin",
            level: "info",
            message: `Ralph loop stopped: max iterations (${state.maxIterations}) reached`,
          },
        })
        return
      }

      // Check if all features are passing (only when max_iterations = 0, i.e., infinite mode)
      const featureStatus = checkAllFeaturesPassing(directory, state.featureListPath)
      if (state.maxIterations === 0 && featureStatus?.allPassing) {
        deleteRalphState(directory)
        await client.app.log({
          body: {
            service: "ralph-plugin",
            level: "info",
            message: `Ralph loop completed: All ${featureStatus.total} features passing!`,
          },
        })
        return
      }

      // Continue the loop - increment iteration and feed prompt back
      const nextIteration = state.iteration + 1
      writeRalphState(directory, {
        ...state,
        iteration: nextIteration,
      })

      // Build the continuation message
      let systemMsg = `Ralph iteration ${nextIteration}`
      if (featureStatus) {
        systemMsg += ` | Features: ${featureStatus.passing}/${featureStatus.total} passing`
      }
      if (state.completionPromise) {
        systemMsg += ` | To stop: output <promise>${state.completionPromise}</promise> (ONLY when TRUE)`
      } else if (state.maxIterations > 0) {
        systemMsg += ` / ${state.maxIterations}`
      } else if (!featureStatus) {
        systemMsg += ` | No completion promise set - loop runs until cancelled`
      }

      // Log the iteration
      await client.app.log({
        body: {
          service: "ralph-plugin",
          level: "info",
          message: systemMsg,
        },
      })

      // Compact/summarize the session context before continuing to prevent context overflow
      // This clears the context window by creating a summary of the conversation
      try {
        await client.session.summarize({
          path: { id: event.properties.sessionID },
        })
        await client.app.log({
          body: {
            service: "ralph-plugin",
            level: "info",
            message: `Context compacted before iteration ${nextIteration}`,
          },
        })
      } catch (err) {
        await client.app.log({
          body: {
            service: "ralph-plugin",
            level: "warn",
            message: `Could not compact context: ${err}`,
          },
        })
      }

      // Append the prompt back to continue the session
      // The prompt includes a marker showing the iteration
      const continuationPrompt = `[${systemMsg}]\n\n${state.prompt}`

      // Use session.prompt to continue the conversation
      await client.session.prompt({
        path: { id: event.properties.sessionID },
        body: {
          parts: [{ type: "text", text: continuationPrompt }],
        },
      })
    },
  }
}