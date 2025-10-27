# Git Workflow Instructions for Copilot

When working with Git, follow these practices:

## Branching

- Create feature branches: `feature/user-auth`, `fix/timeout-issue`
- One feature/fix per branch
- Keep branches short-lived

## Atomic Commits

- One logical change per commit
- Each commit should compile and pass tests
- Stage selectively: `git add -p`

## Commit Messages

Format: `<type>: <subject>`

Types: feat, fix, refactor, docs, test, chore

Good examples:
```
feat: Add email validation to registration
fix: Resolve race condition in payment processing
refactor: Extract API client to separate module
```

## Pull Requests

Before creating PR:
1. Update with main branch
2. Run all tests
3. Write clear PR description with testing steps

## Safety

- NEVER force push to main/master
- ALWAYS pull before push
- ALWAYS run tests before commit
- Review changes with `git diff` before committing

Follow these practices for clean, collaborative Git history.
