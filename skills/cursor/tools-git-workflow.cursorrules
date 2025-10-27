# Git Workflow Best Practices

Follow these Git practices for effective team collaboration:

## 1. Branch Management

**Create descriptive feature branches:**
```bash
git checkout -b feature/user-authentication
git checkout -b fix/api-timeout-issue
git checkout -b refactor/database-queries
```

**Naming conventions:**
- `feature/` - new features
- `fix/` or `bugfix/` - bug fixes
- `refactor/` - code refactoring
- `docs/` - documentation updates

**Keep branches focused:**
- One feature/fix per branch
- Merge frequently (don't let branches diverge)
- Delete branches after merging

## 2. Atomic Commits

**Each commit = one logical change:**
- ✅ "Add user email validation"
- ✅ "Fix null pointer in getUserProfile"
- ❌ "Add feature, fix bugs, update docs" (too broad)

**Ensure each commit is functional:**
- Code should compile after each commit
- Tests should pass after each commit

## 3. Commit Messages

**Format:**
```
<type>: <subject>

<body (optional)>

<footer (optional)>
```

**Types:** feat, fix, refactor, docs, test, chore

**Subject line:**
- Use imperative mood: "Add feature" not "Added feature"
- Keep to 50 characters or less
- Don't end with period

**Good examples:**
```
feat: Add email validation to user registration

Validates email format and checks for existing accounts
before creating new users.

Closes #123
```

```
fix: Resolve race condition in payment processing

Added database-level locks to prevent duplicate charges.

Fixes #456
```

**Bad examples:**
```
❌ "Update stuff"
❌ "WIP"
❌ "Fix bug"
❌ "changes"
```

## 4. Pull Request Workflow

**Before creating PR:**
```bash
# Update with latest main
git checkout main
git pull origin main
git checkout your-feature-branch
git merge main

# Run tests
npm test

# Push branch
git push origin your-feature-branch
```

**PR description should include:**
- Summary of changes
- Why the change was needed
- How to test it
- Link to related issues

## 5. Safety Practices

**NEVER force push to shared branches:**
```bash
# ❌ NEVER on main/develop
git push --force origin main

# ✅ Only on your own feature branches
git push --force origin your-feature-branch
```

**Stash work before switching branches:**
```bash
git stash save "WIP: working on authentication"
git checkout other-branch
# Later...
git checkout your-branch
git stash pop
```

**Review changes before committing:**
```bash
git diff            # See unstaged changes
git diff --staged   # See staged changes
git status          # Check overall status
```

## 6. Useful Commands

**View history:**
```bash
git log --oneline --graph --decorate
git blame src/api.js
```

**Undo changes:**
```bash
git checkout -- filename.js      # Discard unstaged changes
git reset HEAD filename.js       # Unstage file
git reset --soft HEAD~1          # Undo last commit (keep changes)
```

**Run independent operations in parallel:**
```bash
# Combine related operations
git checkout main && git pull origin main
git fetch && git status
```

## Critical Rules

- NEVER commit directly to main/master - use feature branches
- NEVER force push to shared branches - will overwrite others' work
- ALWAYS pull before pushing - avoid merge conflicts
- ALWAYS run tests before committing - broken commits hurt team
- Write meaningful commit messages - "fix bug" helps nobody
- Keep commits atomic - one logical change per commit

## Workflow Example

```bash
# 1. Start feature
git checkout main
git pull origin main
git checkout -b feature/email-notifications

# 2. Make changes and commit atomically
git add src/email-service.js tests/email-service.test.js
git commit -m "feat: Add email service with SMTP support"

# 3. Update with main
git checkout main && git pull origin main
git checkout feature/email-notifications
git merge main

# 4. Run tests
npm test

# 5. Push and create PR
git push origin feature/email-notifications
```

Apply these Git practices consistently across all projects.
