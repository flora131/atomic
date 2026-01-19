/**
 * Ralph Wiggum Plugin for OpenCode
 *
 * Implementation of the Ralph Wiggum technique - continuous self-referential AI loops
 * for interactive iterative development. Runs the AI in a while-true loop with the
 * same prompt until task completion.
 *
 * Original technique: https://ghuntley.com/ralph/
 */

import { Plugin, tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs"
import { join } from "path"

interface RalphState {
  active: boolean
  iteration: number
  max_iterations: number
  completion_promise: string | null
  feature_list_path: string
  started_at: string
  prompt: string
}

const RALPH_STATE_FILE = ".opencode/ralph-loop.local.json"

function readRalphState(directory: string): RalphState | null {
  const statePath = join(directory, RALPH_STATE_FILE)
  if (!existsSync(statePath)) {
    return null
  }
  try {
    const content = readFileSync(statePath, "utf-8")
    return JSON.parse(content) as RalphState
  } catch {
    return null
  }
}

function writeRalphState(directory: string, state: RalphState): void {
  const statePath = join(directory, RALPH_STATE_FILE)
  const dir = join(directory, ".opencode")
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function deleteRalphState(directory: string): void {
  const statePath = join(directory, RALPH_STATE_FILE)
  if (existsSync(statePath)) {
    unlinkSync(statePath)
  }
}

function testAllFeaturesPassing(directory: string, featureListPath: string): { passing: boolean; message: string } {
  const fullPath = join(directory, featureListPath)
  if (!existsSync(fullPath)) {
    return { passing: false, message: `Feature list not found at: ${featureListPath}` }
  }

  try {
    const content = readFileSync(fullPath, "utf-8")
    const features = JSON.parse(content) as Array<{ passes?: boolean }>

    const total = features.length
    if (total === 0) {
      return { passing: false, message: "Feature list is empty" }
    }

    const passingCount = features.filter((f) => f.passes === true).length
    const failing = total - passingCount

    return {
      passing: failing === 0,
      message: `Feature Progress: ${passingCount} / ${total} passing (${failing} remaining)`,
    }
  } catch {
    return { passing: false, message: `Failed to parse feature list: ${featureListPath}` }
  }
}

export const RalphPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  console.log("[Ralph] Plugin initialized")

  return {
    tool: {
      // Custom tool: ralph-loop - Start a Ralph loop
      "ralph-loop": tool({
        description:
          "Start a Ralph Wiggum loop. Runs the AI in a self-referential loop with the same prompt until completion.",
        args: {
          prompt: tool.schema.string().optional().describe("The prompt to repeat each iteration (default: /implement-feature)"),
          max_iterations: tool.schema.number().optional().describe("Maximum iterations before auto-stop (0 = unlimited)"),
          completion_promise: tool.schema.string().optional().describe("Promise phrase to signal completion (e.g., 'DONE')"),
          feature_list: tool.schema.string().optional().describe("Path to feature list JSON (default: research/feature-list.json)"),
        },
        async execute(args) {
          const maxIterations = args.max_iterations || 0
          const completionPromise = args.completion_promise || null
          const featureListPath = args.feature_list || "research/feature-list.json"

          // Default prompt includes /implement-feature and critical instructions
          // Users can fully override by providing their own prompt
          const DEFAULT_PROMPT = `/implement-feature

<EXTREMELY_IMPORTANT>
- Implement features incrementally, make small changes each iteration.
  - Only work on the SINGLE highest priority feature at a time.
  - Use the \`feature-list.json\` file if it is provided to you as a guide otherwise create your own \`feature-list.json\` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
</EXTREMELY_IMPORTANT>`

          const fullPrompt = args.prompt || DEFAULT_PROMPT

          // Check if using default /implement-feature and feature list is missing
          if (!args.prompt && !existsSync(join(directory, featureListPath))) {
            return `Error: Feature list not found at: ${featureListPath}

The default /implement-feature prompt requires a feature list. Either:
1. Create the feature list: /create-feature-list
2. Specify a different path with feature_list parameter
3. Use a custom prompt instead`
          }

          const state: RalphState = {
            active: true,
            iteration: 1,
            max_iterations: maxIterations,
            completion_promise: completionPromise,
            feature_list_path: featureListPath,
            started_at: new Date().toISOString(),
            prompt: fullPrompt,
          }

          writeRalphState(directory, state)

          return `🔄 Ralph loop activated!

Iteration: 1
Max iterations: ${maxIterations > 0 ? maxIterations : "unlimited"}
Completion promise: ${completionPromise ? `${completionPromise} (ONLY output when TRUE - do not lie!)` : "none (runs based on feature list or forever)"}

The loop will continue until:
${maxIterations > 0 ? `• Max iterations (${maxIterations}) reached\n` : ""}${completionPromise ? `• <promise>${completionPromise}</promise> detected in output\n` : ""}${maxIterations === 0 ? `• All features in ${featureListPath} are passing\n` : ""}
State file: ${RALPH_STATE_FILE}

Prompt: ${args.prompt ? `custom: ${args.prompt}` : `default:\n${DEFAULT_PROMPT}`}`
        },
      }),

      // Custom tool: cancel-ralph - Cancel an active Ralph loop
      "cancel-ralph": tool({
        description: "Cancel an active Ralph Wiggum loop",
        args: {},
        async execute() {
          const state = readRalphState(directory)

          if (!state) {
            return "No active Ralph loop found."
          }

          const iteration = state.iteration
          deleteRalphState(directory)

          return `Cancelled Ralph loop (was at iteration ${iteration})`
        },
      }),

      // Custom tool: ralph-help - Explain the technique
      "ralph-help": tool({
        description: "Explain the Ralph Wiggum technique and available commands",
        args: {},
        async execute() {
          return `# Ralph Wiggum Technique

## What is it?
The Ralph Wiggum technique is an iterative development methodology based on continuous AI loops, pioneered by Geoffrey Huntley.

**Core concept:**
\`\`\`bash
while :; do
  cat PROMPT.md | opencode --continue
done
\`\`\`

Each iteration:
1. AI receives the SAME prompt
2. Works on the task, modifying files
3. Session goes idle
4. Plugin sends the same prompt again
5. AI sees its previous work in files
6. Iteratively improves until completion

## Available Tools

### ralph-loop
Start a loop with: \`ralph-loop\` tool
- prompt: The prompt to repeat (default: /implement-feature)
- max_iterations: Max iterations (0 = unlimited)
- completion_promise: Promise phrase to signal completion
- feature_list: Path to feature list JSON

### cancel-ralph
Cancel an active loop with: \`cancel-ralph\` tool

### Completion Promises
To signal completion, output: \`<promise>YOUR_PHRASE</promise>\`

## When to Use
**Good for:**
- Well-defined tasks with clear success criteria
- Iterative development with self-correction
- Greenfield projects

**Not good for:**
- Tasks requiring human judgment
- One-shot operations
- Unclear success criteria

## Learn More
- Original: https://ghuntley.com/ralph/
- Ralph Orchestrator: https://github.com/mikeyobrien/ralph-orchestrator`
        },
      }),
    },

    // Event hook to handle session.idle and continue the loop
    event: async ({ event }) => {
      // Check if this is a session.idle event
      if (event.type !== "session.idle") {
        return
      }

      const state = readRalphState(directory)
      if (!state || !state.active) {
        return
      }

      console.log(`[Ralph] Session idle detected at iteration ${state.iteration}`)

      // Check max iterations
      if (state.max_iterations > 0 && state.iteration >= state.max_iterations) {
        console.log(`[Ralph] Max iterations (${state.max_iterations}) reached`)
        deleteRalphState(directory)
        return
      }

      // Check feature list (only when max_iterations = 0)
      if (state.max_iterations === 0) {
        const featureCheck = testAllFeaturesPassing(directory, state.feature_list_path)
        console.log(`[Ralph] ${featureCheck.message}`)
        if (featureCheck.passing) {
          console.log("[Ralph] All features passing! Exiting loop.")
          deleteRalphState(directory)
          return
        }
      }

      // Increment iteration
      const nextIteration = state.iteration + 1
      state.iteration = nextIteration
      writeRalphState(directory, state)

      // Build system message
      let systemMsg = `🔄 Ralph iteration ${nextIteration}`
      if (state.completion_promise) {
        systemMsg += ` | To stop: output <promise>${state.completion_promise}</promise> (ONLY when statement is TRUE - do not lie!)`
      }

      console.log(`[Ralph] ${systemMsg}`)

      // Send the same prompt back using the client
      // @ts-ignore - session types may vary
      const sessionID = event.properties?.sessionID || event.sessionID

      if (sessionID && client?.session?.promptAsync) {
        try {
          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              parts: [
                { type: "text", text: systemMsg },
                { type: "text", text: state.prompt },
              ],
            },
          })
          console.log("[Ralph] Sent prompt for next iteration")
        } catch (err) {
          console.error("[Ralph] Failed to send prompt:", err)
        }
      } else {
        console.log("[Ralph] Could not send prompt - client or sessionID not available")
      }
    },
  }
}

export default RalphPlugin
