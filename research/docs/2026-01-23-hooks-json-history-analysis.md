# Git History Analysis: .claude/hooks/hooks.json

**Date**: 2026-01-23
**Investigation**: Why was hooks.json created instead of adding hooks to settings.json?

## Timeline

### January 21, 2026 - Initial Implementation (Commit 99f3999)
**Author**: flora131 (via Claude Code AI assistant)
**Commit**: `feat(telemetry): add agent session hooks for all platforms`

**Files Created:**
- `.claude/hooks/hooks.json` ← Used wrong hook name and wrong file location
- `.claude/hooks/telemetry-stop.sh` ← Script is correct
- `.github/hooks/hooks.json` (updated) ← Used wrong case for hook names
- `.github/hooks/prompt-hook.sh` (new)
- `.github/hooks/stop-hook.sh` (updated with telemetry)

### January 22, 2026 - Bug Fix (Commit 89e7b01)
**Commit**: `fix(telemetry): add early exit when jq is unavailable`
**Changes**: Updated `.claude/hooks/telemetry-stop.sh` only
**Note**: Did not fix the hooks.json location or hook name issues

## Root Cause: Spec Error

The implementation followed the specification in `specs/anonymous-telemetry-implementation.md`, which contained **incorrect guidance**:

### What the Spec Said (Incorrect)

```markdown
| Agent       | Hook Type         | Data Available              | Implementation Path           |
|-------------|-------------------|-----------------------------|-------------------------------|
| Claude Code | `Stop` shell hook | `transcript_path` via stdin | `.claude/hooks/telemetry-stop.sh` |
```

**Problems with the spec:**
1. ❌ Specified "Stop" hook → Should have been "SessionEnd"
2. ❌ Implied standalone hooks.json was valid → Should have specified settings.json
3. ❌ No explicit configuration format guidance → Led to copying .github/hooks/hooks.json format

### What Should Have Been Specified

```markdown
| Agent       | Hook Type              | Configuration Location       | Implementation Path           |
|-------------|------------------------|------------------------------|-------------------------------|
| Claude Code | `SessionEnd` shell hook | `.claude/settings.json`     | `.claude/hooks/telemetry-stop.sh` |
```

## How the Error Propagated

### 1. Spec Followed Copilot CLI Pattern

The `.github/hooks/hooks.json` format was created earlier for the Ralph loop system (copilot-cli). The spec author likely:
1. Saw `.github/hooks/hooks.json` working for copilot-cli
2. Assumed the same pattern would work for Claude Code
3. Created `.claude/hooks/hooks.json` following the same structure

**But**: Ralph's hook system is independent from Claude Code's official hooks system!

### 2. AI Implementation Followed Spec Literally

Claude Code (the AI) implemented exactly what the spec requested:
```json
{
  "version": 1,
  "hooks": {
    "Stop": [  // ← From spec
      {
        "type": "command",
        "bash": "./.claude/hooks/telemetry-stop.sh",
        "cwd": ".",
        "timeoutSec": 30
      }
    ]
  }
}
```

### 3. No Runtime Errors = Silent Failure

Claude Code doesn't emit warnings when it encounters unknown configuration files. The hook simply never fired, with no indication why.

## Comparison: Ralph vs Claude Code Hooks

### Ralph Loop (.github/hooks/hooks.json)
- **System**: Custom hook system for copilot-cli
- **Format**: Custom JSON schema with `version`, `bash`, `cwd`, `timeoutSec` fields
- **Hook Names**: Uses lowercase (`sessionStart`, `sessionEnd`, `userPromptSubmitted`)
- **Read by**: Ralph loop scripts in `.github/scripts/`
- **Status**: ✅ Works for Ralph, but is NOT Claude Code's official hook system

### Claude Code (.claude/settings.json)
- **System**: Official Claude Code hooks (documented at code.claude.com)
- **Format**: Part of settings.json with specific structure
- **Hook Names**: PascalCase (`SessionStart`, `SessionEnd`, `UserPromptSubmit`)
- **Read by**: Claude Code CLI binary
- **Fields**: `command` (not `bash`), `timeout` (not `timeoutSec`), no `cwd`
- **Status**: ✅ Official, documented API

## Why Tests Appeared to Work

When testing via AI agents:
1. AI spawns agents using Task tool
2. This may trigger different code paths or use Ralph's system
3. Ralph's `.github/hooks/hooks.json` configuration DOES work for copilot-cli
4. So telemetry appeared to work during AI tests
5. But manual `claude` command never triggered hooks (wrong config location)

## The Fix

### Before (Incorrect)
```
.claude/hooks/hooks.json       ← Claude Code doesn't read this
.claude/hooks/telemetry-stop.sh ← Correct
.claude/settings.json          ← No hooks configured
```

### After (Correct)
```
.claude/hooks/telemetry-stop.sh ← Correct
.claude/settings.json          ← Now contains hooks configuration
```

```json
{
  "hooks": {
    "SessionEnd": [  // ← Fixed: SessionEnd not Stop
      {
        "hooks": [
          {
            "type": "command",  // ← Fixed: command not bash
            "command": "./.claude/hooks/telemetry-stop.sh",
            "timeout": 30  // ← Fixed: timeout not timeoutSec
          }
        ]
      }
    ]
  }
}
```

## Lessons Learned

1. **Verify official documentation**: Don't assume all hook systems work the same way
2. **Look for runtime warnings**: Claude Code's silent failure made debugging harder
3. **Test both ways**: Manual testing (`claude`) vs automated testing (AI agents)
4. **Spec review**: Technical specs need review by someone familiar with the target system
5. **Hook names matter**: Case sensitivity and exact naming are critical

## Recommendations

### For Future Hook Implementations

1. **Always reference official docs first**: https://code.claude.com/docs/en/hooks
2. **Use `/hooks` UI**: Claude Code provides interactive hook configuration
3. **Test manually**: Don't rely only on AI-assisted testing
4. **Enable debug mode**: `claude --debug` shows hook execution details
5. **Check settings.json**: Verify hooks are actually registered where Claude Code reads them

### For the Spec

The `specs/anonymous-telemetry-implementation.md` should be updated to clarify:
- Correct hook name: `SessionEnd` not `Stop`
- Correct location: `.claude/settings.json` not `.claude/hooks/hooks.json`
- Correct format: Reference official Claude Code hooks documentation
- Distinction between Ralph's custom hooks and Claude Code's official hooks

## References

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Settings Guide](https://code.claude.com/docs/en/settings)
- Commit 99f3999: Initial (incorrect) implementation
- Commit 89e7b01: Bug fix (didn't address root cause)
- Spec: `specs/anonymous-telemetry-implementation.md` (contains errors)
