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
const DEFAULT_PROMPT = `/implement-feature

<EXTREMELY_IMPORTANT>
- Implement features incrementally, make small changes each iteration.
  - Only work on the SINGLE highest priority feature at a time.
  - Use the \`feature-list.json\` file if it is provided to you as a guide otherwise create your own \`feature-list.json\` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
</EXTREMELY_IMPORTANT>`

function parseRalphState(directory: string): RalphState | null {
  const statePath = join(directory, STATE_FILE)

  if (!existsSync(statePath)) {
    return null
  }

  try {
    const content = readFileSync(statePath, "utf-8")

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
      if (event.type !== "session.idle") return

      const state = parseRalphState(directory)
      if (!state || !state.active) return

      // Get the last assistant message to check for completion
      // We need to check if the completion promise was output
      if (state.completionPromise) {
        try {
          // Use the SDK to get session messages
          const session = await client.session.get({ id: event.properties.sessionID })
          if (session.messages && session.messages.length > 0) {
            // Find the last assistant message
            const lastAssistantMsg = [...session.messages]
              .reverse()
              .find((m) => m.role === "assistant")

            if (lastAssistantMsg) {
              // Extract text content from message parts
              const textContent = lastAssistantMsg.parts
                ?.filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")

              if (textContent && checkCompletionPromise(textContent, state.completionPromise)) {
                // Completion promise detected - stop the loop
                deleteRalphState(directory)
                await client.app.log({
                  service: "ralph-plugin",
                  level: "info",
                  message: `Ralph loop completed: detected <promise>${state.completionPromise}</promise>`,
                })
                return
              }
            }
          }
        } catch (err) {
          // If we can't check messages, continue the loop
          await client.app.log({
            service: "ralph-plugin",
            level: "warn",
            message: `Could not check for completion promise: ${err}`,
          })
        }
      }

      // Check max iterations
      if (state.maxIterations > 0 && state.iteration >= state.maxIterations) {
        deleteRalphState(directory)
        await client.app.log({
          service: "ralph-plugin",
          level: "info",
          message: `Ralph loop stopped: max iterations (${state.maxIterations}) reached`,
        })
        return
      }

      // Check if all features are passing (only when max_iterations = 0, i.e., infinite mode)
      const featureStatus = checkAllFeaturesPassing(directory, state.featureListPath)
      if (state.maxIterations === 0 && featureStatus?.allPassing) {
        deleteRalphState(directory)
        await client.app.log({
          service: "ralph-plugin",
          level: "info",
          message: `Ralph loop completed: All ${featureStatus.total} features passing!`,
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
        service: "ralph-plugin",
        level: "info",
        message: systemMsg,
      })

      // Append the prompt back to continue the session
      // The prompt includes a marker showing the iteration
      const continuationPrompt = `[${systemMsg}]\n\n${state.prompt}`

      // Use session.send to continue the conversation
      await client.session.send({
        id: event.properties.sessionID,
        text: continuationPrompt,
      })
    },
  }
}