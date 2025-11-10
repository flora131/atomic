# Agent Prompt Guidelines

## Best Practices

**Keep prompts short and concise.** Effective agent prompts are clear and focused, not verbose. Detailed specifications should be maintained in separate documents (specs, design docs, etc.) and referenced when needed.

## Example: Repository Porting Project Prompt from repomirror

Your job is to port repomirror (TypeScript) to repomirror-py (Python) and maintain the repository. Use the implementation spec under specs/port-repomirror. 

Use the specs/port-repomirror/agent/ directory as a scratchpad for your work. Store long term plans and todo lists there.

Make a commit and push your changes after every single file edit.

You have access to the current ./ repository as well as the target /tmp/test-target2 repository.

The original project was mostly tested by manually running the code. When porting, you will need to write end to end and unit tests for the project. But make sure to spend most of your time on the actual porting, not on the testing. A good heuristic is to spend 80% of your time on the actual porting, and 20% on the testing.