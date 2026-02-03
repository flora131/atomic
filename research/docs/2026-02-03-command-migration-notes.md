# Migration Notes: Removed Commands

**Date:** 2026-02-03
**Status:** Documentation
**Author:** Research Agent

## Executive Summary

This document provides migration notes for users upgrading to the new Atomic version that replaces hook-based Ralph implementation with SDK-native graph execution. Several commands have been removed and consolidated into simpler patterns.

---

## Table of Contents

1. [Overview](#overview)
2. [/atomic replaced by /ralph](#atomic-replaced-by-ralph)
3. [/ralph:* hook-based commands removed](#ralph-hook-based-commands-removed)
4. [/approve, /reject, /status removed](#approve-reject-status-removed)
5. [Spec Approval is Now Manual](#spec-approval-is-now-manual)
6. [Progress Tracking via progress.txt](#progress-tracking-via-progresstxt)
7. [Migration Checklist](#migration-checklist)

---

## Overview

The Atomic CLI has undergone a significant architectural upgrade, replacing the legacy hook-based execution model with an SDK-native graph execution engine. This change brings:

- **Simpler workflow execution**: Start with `/ralph` instead of multiple commands
- **Better session management**: UUID-based sessions with pause/resume support
- **Unified experience**: Same workflow behavior across Claude, OpenCode, and Copilot backends
- **Improved reliability**: No file-based state conflicts in parallel sessions

As part of this upgrade, several commands have been removed or consolidated.

---

## /atomic replaced by /ralph

### What Changed

The `/atomic` command has been replaced by `/ralph`. This consolidates the workflow entry point into a single, well-defined command.

### Migration

| Before | After |
|--------|-------|
| `/atomic` | `/ralph` |
| `/atomic --yolo <prompt>` | `/ralph --yolo <prompt>` |

### New Features in /ralph

The `/ralph` command includes enhanced functionality:

```bash
# Standard mode with feature-list.json
/ralph

# Freestyle mode (no feature list required)
/ralph --yolo <prompt>

# Resume a paused session
/ralph --resume <session-uuid>

# Custom feature list path
/ralph --feature-list path/to/features.json

# Set max iterations (default: 100, 0 = infinite)
/ralph --max-iterations 50

# Combine flags
/ralph --max-iterations 200 --feature-list custom.json
/ralph --yolo --max-iterations 0 "build a snake game"
```

---

## /ralph:* hook-based commands removed

### What Changed

All hook-based Ralph commands have been removed:

| Removed Command | Purpose | Replacement |
|----------------|---------|-------------|
| `/ralph:ralph-loop` | Start the Ralph implementation loop | `/ralph` |
| `/ralph:cancel-ralph` | Cancel active Ralph execution | Press `Ctrl+C` or `Esc` |
| `/ralph:ralph-help` | Show Ralph help information | `/help` (includes Ralph section) |

### Migration

**Starting Ralph:**
```bash
# Before (hook-based)
/ralph:ralph-loop

# After (SDK-native)
/ralph
```

**Stopping Ralph:**
```bash
# Before (hook-based)
/ralph:cancel-ralph

# After (SDK-native)
# Press Ctrl+C or Esc during execution
# This saves a checkpoint and displays resume instructions:
# "Paused Ralph session: abc123-def456"
# "Resume with: /ralph --resume abc123-def456"
```

**Getting Help:**
```bash
# Before (hook-based)
/ralph:ralph-help

# After (built-in)
/help
# The /help output now includes Ralph workflow documentation
```

### Why This Change?

The hook-based implementation had several limitations:
1. **File conflicts**: Multiple sessions could corrupt shared state files
2. **Limited control**: Cancellation relied on file-based signals
3. **No resume**: Lost progress on interruption
4. **Agent-specific**: Different implementations per SDK

The new SDK-native approach provides:
1. **Session isolation**: UUID-based sessions with dedicated directories
2. **Checkpointing**: Resume from any interruption point
3. **Unified behavior**: Same workflow across all SDK backends
4. **Better UX**: Keyboard interrupts with clear resume instructions

---

## /approve, /reject, /status removed

### What Changed

Three workflow control commands have been removed:

| Removed Command | Purpose | Replacement |
|----------------|---------|-------------|
| `/approve` | Approve the generated spec | Manual review before `/ralph` |
| `/reject` | Reject spec with feedback | Manual editing before `/ralph` |
| `/status` | Show workflow progress | `research/progress.txt` |

### Migration

#### Spec Approval

**Before:**
```bash
# 1. Run research
/research-codebase

# 2. Create spec
/create-spec

# 3. Approve or reject spec
/approve
# or
/reject "The spec should include X, Y, Z"
```

**After:**
```bash
# 1. Run research
/research-codebase

# 2. Create spec
/create-spec

# 3. Review the generated spec manually
# Edit research/spec.md if needed

# 4. Start Ralph when satisfied
/ralph
```

#### Progress Tracking

**Before:**
```bash
/status
# Output: "Features completed: 3/10, Current: Implement auth..."
```

**After:**
```bash
# Check the progress file directly
cat research/progress.txt

# Or for session-specific progress
cat .ralph/sessions/<uuid>/progress.txt
```

---

## Spec Approval is Now Manual

### New Workflow

The spec approval step is now a manual process performed **before** starting the `/ralph` workflow. This provides several benefits:

1. **Full control**: Review and edit specs in your preferred editor
2. **No time pressure**: Take as long as needed for thorough review
3. **Version control**: Commit spec changes before implementation
4. **Collaboration**: Share specs with team members for review

### Recommended Process

1. **Generate Research:**
   ```bash
   /research-codebase
   ```
   This creates documentation in `research/` about your codebase.

2. **Generate Spec:**
   ```bash
   /create-spec
   ```
   This generates `research/spec.md` based on the research.

3. **Review and Edit:**
   - Open `research/spec.md` in your editor
   - Review the technical approach
   - Edit as needed (add requirements, clarify scope, etc.)
   - Optionally commit: `git add research/spec.md && git commit -m "Review spec"`

4. **Generate Feature List:**
   ```bash
   /create-feature-list
   ```
   This creates `research/feature-list.json` from the spec.

5. **Review Feature List:**
   - Open `research/feature-list.json`
   - Verify feature breakdown makes sense
   - Adjust priorities or descriptions if needed

6. **Start Implementation:**
   ```bash
   /ralph
   ```

### Spec File Locations

| File | Purpose |
|------|---------|
| `research/spec.md` | Technical specification document |
| `research/feature-list.json` | Implementable feature breakdown |
| `research/progress.txt` | Implementation progress log |

---

## Progress Tracking via progress.txt

### New Progress Tracking

Progress is now tracked via text files rather than an interactive command:

#### Global Progress

The main progress file is at `research/progress.txt`:

```
## 2026-02-03 - Feature Implementation: Implement auth system

### Status: COMPLETED

Implemented authentication system with JWT tokens...

#### Tests Added
- test_login_success
- test_login_invalid_credentials
...

---

## 2026-02-03 - Feature Implementation: Create user profile API

### Status: IN_PROGRESS
...
```

#### Session Progress

Each Ralph session maintains its own progress file:

```
# .ralph/sessions/<uuid>/progress.txt

[2026-02-03T10:15:30Z] Started Ralph session: abc123-def456
[2026-02-03T10:16:45Z] ✓ Implement auth system
[2026-02-03T10:25:12Z] ✓ Create user profile API
[2026-02-03T10:45:33Z] ✗ Add email notifications (failed)
[2026-02-03T10:46:00Z] Paused at iteration 15
```

### Benefits of File-Based Progress

1. **Persistent**: Survives application restarts
2. **Git-trackable**: Can commit progress updates
3. **Readable**: Plain text, viewable anywhere
4. **Searchable**: Grep for specific features or dates
5. **Diffable**: See changes over time

### Monitoring Progress

```bash
# Watch progress in real-time
tail -f research/progress.txt

# Search for completed features
grep "Status: COMPLETED" research/progress.txt

# Count completed vs total
grep -c "passes.*true" research/feature-list.json
```

---

## Migration Checklist

Use this checklist when upgrading to the new Atomic version:

### Before Upgrading

- [ ] Complete any in-progress `/atomic` workflows
- [ ] Back up your `research/` directory
- [ ] Note any custom Ralph configurations

### After Upgrading

- [ ] Update any scripts using `/atomic` to use `/ralph`
- [ ] Update any scripts using `/ralph:*` commands
- [ ] Remove any `/approve`, `/reject`, `/status` references
- [ ] Update documentation referencing old commands
- [ ] Test `/ralph` workflow with a simple feature list

### Configuration Updates

- [ ] Review `.atomic/workflows/` for custom workflows
- [ ] Check `~/.atomic/workflows/` for global workflows
- [ ] Verify `research/feature-list.json` format compatibility

### Scripts to Update

If you have automation scripts, update these patterns:

```bash
# Before
atomic-cli /atomic

# After
atomic-cli /ralph
```

```bash
# Before
atomic-cli /ralph:ralph-loop

# After
atomic-cli /ralph
```

```bash
# Before
atomic-cli /status

# After
cat research/progress.txt
```

---

## Related Documentation

- `src/ui/commands/workflow-commands.ts` - /ralph command implementation
- `src/workflows/ralph.ts` - Ralph workflow graph definition
- `src/workflows/ralph-session.ts` - Session management
- `research/docs/2026-02-03-workflow-composition-patterns.md` - Workflow composition
- `research/docs/2026-02-03-custom-workflow-file-format.md` - Custom workflows
