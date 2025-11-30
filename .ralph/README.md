# Ralph Wiggum Method: Autonomous Execution

Run AI agents in continuous loops until task completion - no manual intervention required.

> **Note:** Currently only supported for Claude Code. Support for other AI coding assistants coming soon.

**Prerequisites:** You must have copied `.ralph/` to your project (see [main setup instructions](../README.md#step-1-copy-templates-to-your-project)).

**How it works:** Agent reads `.ralph/prompt.md`, executes tasks, iterates until done, manages its own context.

## Usage

1. **Update `.ralph/prompt.md`** with your implementation instructions
   - Keep it concise - reference detailed specs from `specs/` directory
   - Example prompt below

2. **Test one iteration:**
   ```bash
   cd /path/to/your-project
   ./.ralph/sync.sh
   ```
   Verifies the agent can read your prompt and execute successfully

3. **Run continuously:**
   ```bash
   ./.ralph/ralph.sh
   ```
   Agent loops, working until task completion

## Best Environments to Run Ralph

Since Ralph runs continuously, it's best to run it in environments designed for long-running processes. Consider the following options:
- **Cloud VM**: Use a terminal multiplexer like [tmux](https://github.com/tmux/tmux) and setup your development environment with basic tools (git, Node.js, Python, Rust, C, C++, etc.)
  - Providers: AWS EC2, Google Cloud Compute Engine, DigitalOcean Droplets, etc.

## Agent Prompt Guidelines

### Best Practices

**Keep prompts short and concise.** Effective agent prompts are clear and focused, not verbose. Detailed specifications should be maintained in separate documents (specs, design docs, etc.) and referenced when needed.

**Additional guidelines:**
- One task per loop
- Clear completion criteria
- Reference specific specs from `specs/`

### Example: Repository Porting Project Prompt (inspired by repomirror)

```
Your job is to port repomirror (TypeScript) to repomirror-py (Python) and maintain the repository. Use the implementation spec under specs/port-repomirror.

Use the specs/port-repomirror/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

Make a commit and push your changes after every single file edit.

You have access to the current ./ repository as well as the target /tmp/test-target2 repository.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.
```
