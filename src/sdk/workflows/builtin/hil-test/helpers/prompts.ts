/**
 * Shared prompts for the HIL test workflow.
 *
 * Every prompt constrains the agent to write ONLY inside `/tmp/hil-test/`
 * and explicitly asks a user question so we can observe the
 * running → awaiting_input → running → complete status transitions.
 *
 * Each builder accepts an optional `questionTool` parameter — the name of
 * the agent-specific tool that must be used to ask the user a question
 * (e.g. `"question"` for OpenCode, `"AskUserQuestion"` for Claude,
 * `"ask_user"` for Copilot).  When provided the prompt explicitly tells
 * the model to invoke that tool rather than printing the question as text.
 */

const SANDBOX_RULE = `
CRITICAL RULES:
- You MUST ONLY create or modify files inside /tmp/hil-test/. Do NOT touch any other directory.
- Do NOT modify any files in the current working directory or repository.
- Create /tmp/hil-test/ if it does not already exist.
`.trim();

/** Build a tool-use instruction for the question step. */
function questionInstruction(questionTool?: string): string {
  if (!questionTool) return "";
  return `\n   You MUST use the \`${questionTool}\` tool to ask the question. Do NOT just print it as text.`;
}

export function buildSetupPrompt(): string {
  return `
You are the setup stage of a test workflow.

${SANDBOX_RULE}

Do the following steps in order:

1. Create the directory /tmp/hil-test/ if it doesn't exist (mkdir -p /tmp/hil-test).
2. Write a file /tmp/hil-test/setup.txt containing:
   - The current date and time
   - The text: "HIL test workflow initialized successfully"
3. List the contents of /tmp/hil-test/ to confirm the file was created.

That's it. Do NOT do anything else.
`.trim();
}

export function buildWorkerAPrompt(questionTool?: string): string {
  return `
You are Worker A in a test workflow.

${SANDBOX_RULE}

Do the following steps IN ORDER — do not skip any step:

1. Write a file /tmp/hil-test/worker-a-start.txt containing:
   - The text: "Worker A has started processing"
   - The current date and time

2. IMPORTANT: Now you MUST ask the user a question. Ask them:
   "Worker A checking in — what color theme should this project use? (e.g. dark, light, solarized)"${questionInstruction(questionTool)}
   Wait for their response before continuing.

3. After the user responds, write a file /tmp/hil-test/worker-a-done.txt containing:
   - The text: "Worker A completed"
   - The user's answer from step 2
   - The current date and time

That's it. Do NOT do anything else.
`.trim();
}

export function buildWorkerBPrompt(questionTool?: string): string {
  return `
You are Worker B in a test workflow.

${SANDBOX_RULE}

Do the following steps IN ORDER — do not skip any step:

1. Write a file /tmp/hil-test/worker-b-start.txt containing:
   - The text: "Worker B has started processing"
   - The current date and time

2. IMPORTANT: Now you MUST ask the user a question. Ask them:
   "Worker B here — what name should we give to the test project? (e.g. Phoenix, Atlas, Nova)"${questionInstruction(questionTool)}
   Wait for their response before continuing.

3. After the user responds, write a file /tmp/hil-test/worker-b-done.txt containing:
   - The text: "Worker B completed"
   - The user's answer from step 2
   - The current date and time

That's it. Do NOT do anything else.
`.trim();
}

export function buildSummarizerPrompt(questionTool?: string): string {
  return `
You are the Summarizer — the final stage of a test workflow.

${SANDBOX_RULE}

Do the following steps IN ORDER — do not skip any step:

1. Read ALL files in /tmp/hil-test/ to see what the previous stages produced.

2. IMPORTANT: Now you MUST ask the user a question. Ask them:
   "I've reviewed all outputs from the previous stages. Any final notes to include in the summary?"${questionInstruction(questionTool)}
   Wait for their response before continuing.

3. After the user responds, write a file /tmp/hil-test/summary.txt containing:
   - A summary of what each previous stage wrote
   - The user's final notes from step 2
   - The text: "HIL test workflow completed successfully"
   - The current date and time

That's it. Do NOT do anything else.
`.trim();
}
