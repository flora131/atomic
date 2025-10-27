---
name: tools-git-workflow
description: Git workflow best practices - feature branches, atomic commits, meaningful messages, pull requests, and safe operations
---

# Git Workflow

## Description

This skill provides best practices for using Git effectively in team environments. Good Git hygiene improves code review quality, makes debugging easier, and prevents lost work.

## When to Use

- **Starting new features** - create feature branches
- **Making commits** - write clear commit messages
- **Before pushing** - ensure commits are logical and atomic
- **Creating pull requests** - organize work for review
- **Reviewing history** - use git log, blame, bisect effectively

## Prerequisites

- Git installed and configured
- Understanding of basic git commands (add, commit, push, pull)
- Access to remote repository
- Know the team's branching strategy (main, develop, feature branches, etc.)

## Instructions

### 1. Branch Management

**Use feature branches for all work**

1. **Create descriptive branch names**
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
   - `test/` - test additions/modifications

2. **Keep branches focused and short-lived**
   - One feature/fix per branch
   - Merge frequently (don't let branches diverge too much)
   - Delete branches after merging

3. **Stay up-to-date with main branch**
   ```bash
   # Update your branch with latest main
   git checkout main
   git pull origin main
   git checkout your-feature-branch
   git merge main
   # Or use rebase (if comfortable):
   git rebase main
   ```

### 2. Atomic Commits

**Each commit should be a single logical change**

1. **One change per commit**
   - ✅ "Add user email validation"
   - ✅ "Fix null pointer in getUserProfile"
   - ❌ "Add feature, fix bugs, update docs" (too broad)

2. **Ensure each commit is functional**
   - Code should compile after each commit
   - Tests should pass after each commit
   - Don't commit broken code

3. **Stage changes selectively**
   ```bash
   # Stage specific files
   git add src/validators.js tests/validators.test.js

   # Stage parts of a file (interactive)
   git add -p src/api.js
   ```

### 3. Commit Messages

**Write clear, informative commit messages**

**Format:**
```
<type>: <subject>

<body (optional)>

<footer (optional)>
```

**Subject line (first line):**
- Start with type: feat, fix, refactor, docs, test, chore
- Use imperative mood: "Add feature" not "Added feature"
- Keep to 50 characters or less
- Don't end with period

**Body (if needed):**
- Explain WHY the change was made (not just what)
- Wrap at 72 characters
- Separate from subject with blank line

**Examples:**

**Good commit messages:**
```
feat: Add email validation to user registration

Validates email format and checks for existing accounts
before creating new users. Prevents duplicate registrations
and provides clear error messages to users.

Closes #123
```

```
fix: Resolve race condition in payment processing

Multiple requests could process the same payment twice due to
lack of transaction locking. Added database-level locks to
prevent duplicate charges.

Fixes #456
```

```
refactor: Extract API client into separate module

Improves testability and reusability of HTTP client code.
No functional changes to API behavior.
```

**Bad commit messages:**
```
❌ "Update stuff"
❌ "WIP"
❌ "Fix bug"
❌ "changes"
❌ "asdf"
```

### 4. Pull Request Workflow

**Organize code for review**

1. **Before creating PR:**
   ```bash
   # Ensure branch is up-to-date
   git checkout main
   git pull origin main
   git checkout your-feature-branch
   git merge main

   # Run tests
   npm test  # or pytest, cargo test, etc.

   # Push branch
   git push origin your-feature-branch
   ```

2. **PR description should include:**
   - Summary of changes
   - Why the change was needed
   - How to test it
   - Screenshots (if UI changes)
   - Link to related issues

   **Example PR template:**
   ```markdown
   ## Summary
   Adds email validation to user registration flow

   ## Motivation
   Users were creating accounts with invalid emails, causing
   delivery failures and support tickets.

   ## Changes
   - Added email format validation
   - Added duplicate email check
   - Updated error messages
   - Added tests for validation logic

   ## Testing
   1. Try registering with invalid email → should show error
   2. Try registering with existing email → should show error
   3. Try registering with valid new email → should succeed

   ## Related Issues
   Closes #123
   ```

3. **Respond to review feedback**
   - Make requested changes in new commits (don't force push)
   - Address all comments
   - Mark conversations as resolved when addressed

### 5. Merge Strategies

**Choose the right merge approach**

**Merge commit (preserves history):**
```bash
git checkout main
git merge --no-ff feature-branch
```
- Creates explicit merge commit
- Preserves full branch history
- Good for long-lived feature branches

**Squash merge (clean history):**
```bash
git checkout main
git merge --squash feature-branch
git commit -m "feat: Add user authentication"
```
- Combines all commits into one
- Cleaner main branch history
- Good for small features with messy commit history

**Rebase (linear history):**
```bash
git checkout feature-branch
git rebase main
git checkout main
git merge feature-branch
```
- Creates linear history (no merge commits)
- Clean, easy to follow
- ⚠️ Don't rebase shared branches

### 6. Git Safety Practices

**Prevent data loss and conflicts**

1. **Never force push to shared branches**
   ```bash
   # ❌ NEVER do this on main/develop
   git push --force origin main

   # ✅ Only force push your own feature branches (if needed)
   git push --force origin your-feature-branch
   ```

2. **Stash work before switching branches**
   ```bash
   # Save uncommitted changes
   git stash save "WIP: working on authentication"

   # Switch branches
   git checkout other-branch

   # Restore stashed work later
   git checkout your-branch
   git stash pop
   ```

3. **Use git status frequently**
   ```bash
   git status  # Check what's staged, modified, untracked
   ```

4. **Review changes before committing**
   ```bash
   git diff            # See unstaged changes
   git diff --staged   # See staged changes
   ```

### 7. Useful Git Commands

**For investigating history:**
```bash
# View commit history
git log --oneline --graph --decorate

# See who changed each line
git blame src/api.js

# Find when a bug was introduced
git bisect start
git bisect bad HEAD
git bisect good v1.0.0

# Search commit messages
git log --grep="authentication"

# Search code changes
git log -S"validateEmail" --source --all
```

**For undoing changes:**
```bash
# Undo unstaged changes to a file
git checkout -- filename.js

# Unstage a file (keep changes)
git reset HEAD filename.js

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes) ⚠️
git reset --hard HEAD~1
```

## Critical Rules

- **NEVER commit directly to main/master** - use feature branches
- **NEVER force push to shared branches** - will overwrite others' work
- **ALWAYS pull before pushing** - avoid merge conflicts
- **ALWAYS run tests before committing** - broken commits hurt team
- **Write meaningful commit messages** - "fix bug" helps nobody
- **Keep commits atomic** - one logical change per commit

## Examples

### Example 1: Feature Branch Workflow

```bash
# 1. Start new feature
git checkout main
git pull origin main
git checkout -b feature/email-notifications

# 2. Make changes and commit atomically
# ... edit code ...
git add src/email-service.js tests/email-service.test.js
git commit -m "feat: Add email service with SMTP support"

# ... edit more code ...
git add src/notification-handler.js tests/notification-handler.test.js
git commit -m "feat: Add notification handler for user events"

# 3. Update with main branch changes
git checkout main
git pull origin main
git checkout feature/email-notifications
git merge main

# 4. Run tests
npm test

# 5. Push and create PR
git push origin feature/email-notifications
# Then create PR via GitHub/GitLab UI
```

### Example 2: Fixing Commit History Before PR

```bash
# You have messy commits like:
# - "WIP"
# - "fix typo"
# - "add feature"
# - "fix bug"
# - "more fixes"

# Squash last 5 commits into one clean commit
git rebase -i HEAD~5

# In the editor:
# pick abc123 WIP
# squash def456 fix typo
# squash ghi789 add feature
# squash jkl012 fix bug
# squash mno345 more fixes

# Write a proper commit message:
# "feat: Add email notifications
#
# Implements SMTP-based email notifications for user events.
# Includes retry logic and error handling."

# Force push to your feature branch (safe because it's your branch)
git push --force origin feature/email-notifications
```

### Example 3: Resolving Merge Conflicts

```bash
# Pull latest main
git checkout main
git pull origin main

# Try to merge into feature branch
git checkout feature-branch
git merge main

# If conflicts occur:
# CONFLICT (content): Merge conflict in src/api.js

# 1. Open conflicted files and resolve manually
# Look for:
# <<<<<<< HEAD
# your changes
# =======
# main branch changes
# >>>>>>> main

# 2. Stage resolved files
git add src/api.js

# 3. Complete merge
git commit -m "merge: Resolve conflicts with main"

# 4. Run tests to ensure nothing broke
npm test
```

## Validation

Before pushing/creating PR, verify:

- ✅ All commits have clear, descriptive messages
- ✅ Each commit is atomic (one logical change)
- ✅ All tests pass
- ✅ No debug code, console.logs, or commented code
- ✅ Branch is up-to-date with main
- ✅ No merge conflicts
- ✅ Code follows project conventions

## Common Pitfalls to Avoid

1. **Committing everything at once** - Make atomic commits instead
2. **Vague commit messages** - "fix stuff" helps nobody
3. **Not pulling before pushing** - Causes conflicts
4. **Committing generated files** - Add to .gitignore
5. **Force pushing shared branches** - Will overwrite others' work
6. **Long-lived branches** - Merge frequently to avoid divergence
7. **Not testing before committing** - Breaks CI/CD

## Related Skills

- `workflow-tdd` - Tests should pass before committing
- `workflow-code-review` - PRs should be reviewable
- `tools-ci-cd` - Git workflow integrates with CI/CD

## Git Configuration

**Recommended global config:**
```bash
# Set your identity
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Better diff output
git config --global diff.algorithm histogram

# Reuse recorded conflict resolutions
git config --global rerere.enabled true

# Default branch name
git config --global init.defaultBranch main

# Helpful aliases
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.lg "log --oneline --graph --decorate"
```
