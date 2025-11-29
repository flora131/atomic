---
agent: 'agent'
model: 'Claude Sonnet 4.5'
tools: ['githubRepo', 'search/codebase', 'runCommands/runInTerminal', 'runCommands/getTerminalOutput']
description: Create a new branch, commit changes, and submit a pull request.
argument-hint: [code-path]

---

# Create Pull Request Command

Create a new branch, commit changes, and submit a pull request.

## Current Repository State

- Git status: !`git status --porcelain`
- Current branch: !`git branch --show-current`
- Staged changes: !`git diff --cached --stat`
- Unstaged changes: !`git diff --stat`
- Recent commits: !`git log --oneline -5`

## Behavior
- Creates a new branch based on current changes
- Formats modified files using Biome
- Analyzes changes and automatically splits into logical commits when appropriate
- Each commit focuses on a single logical change or feature
- Creates descriptive commit messages for each logical unit
- Pushes branch to remote
- Creates pull request with proper summary and test plan

## Guidelines for Automatic Commit Splitting
- Split commits by feature, component, or concern
- Keep related file changes together in the same commit
- Separate refactoring from feature additions
- Ensure each commit can be understood independently
- Multiple unrelated changes should be split into separate commits

## Pull Request Creation Process

1. **Analyze Changes**
   - Review all staged and unstaged changes
   - Identify logical groupings of changes
   - Determine if commits should be split

2. **Create Branch**
   - Generate a descriptive branch name based on the changes
   - Use format: `feature/description`, `fix/description`, or `refactor/description`

3. **Stage and Commit**
   - Stage related changes together
   - Create commits with conventional commit format
   - Include AI attribution trailer

4. **Push and Create PR**
   - Push branch to remote with tracking
   - Create PR with:
     - Clear title summarizing the changes
     - Summary section with bullet points
     - Test plan section with verification steps

## Pull Request Template

```markdown
## Summary
- [Bullet point 1: Main change]
- [Bullet point 2: Secondary change]
- [Additional points as needed]

## Test plan
- [ ] Verify [specific functionality]
- [ ] Run tests: `npm test` or equivalent
- [ ] Manual testing steps as needed
```

## Important Notes

- Follow Conventional Commits specification for commit messages
- Always attribute AI-Assisted Code Authorship with trailer
- Ensure all pre-commit hooks pass before pushing
- Link related issues in PR description when applicable
