# Windows Telemetry Setup Guide

This guide covers Windows-specific setup, configuration, and troubleshooting for Atomic's telemetry system with GitHub Copilot CLI and OpenCode.

## Table of Contents

- [Prerequisites](#prerequisites)
- [PowerShell Version](#powershell-version)
- [Telemetry Data Locations](#telemetry-data-locations)
- [GitHub Copilot CLI Setup](#github-copilot-cli-setup)
- [OpenCode Setup](#opencode-setup)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Privacy and Opt-Out](#privacy-and-opt-out)

---

## Prerequisites

### Required

- **Windows 10 or later**
- **PowerShell 7.0+** (required for telemetry features)
  - Windows PowerShell 5.1 will skip telemetry but maintain Ralph loop functionality
- **GitHub Copilot CLI** and/or **OpenCode** installed

### Recommended

- **Git Bash** (optional, for additional script compatibility)
- **jq** not required (PowerShell has native JSON support)

---

## PowerShell Version

Atomic's Windows telemetry requires **PowerShell 7.0 or higher**. Windows comes with PowerShell 5.1 by default, which does not support cross-platform features used by the telemetry system.

### Check Your PowerShell Version

```powershell
$PSVersionTable.PSVersion
```

Expected output for PowerShell 7+:
```
Major  Minor  Patch  PreReleaseLabel BuildLabel
-----  -----  -----  --------------- ----------
7      5      0
```

If you see version 5.x, you need to install PowerShell 7.

### Install PowerShell 7

**Method 1: Windows Package Manager (winget)**

```powershell
winget install --id Microsoft.Powershell --source winget
```

**Method 2: MSI Installer**

Download from: https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows

**Method 3: Command Line Installer**

```powershell
iex "& { $(irm https://aka.ms/install-powershell.ps1) } -UseMSI"
```

**Verify Installation:**

After installation, open a **new** terminal window and run:

```powershell
pwsh --version
```

---

## Telemetry Data Locations

Atomic stores telemetry data in the standard Windows application data directory.

### Data Directory

```
%LOCALAPPDATA%\atomic\
```

Expanded path example:
```
C:\Users\YourUsername\AppData\Local\atomic\
```

### Telemetry Files

| File | Description |
|------|-------------|
| `telemetry.json` | State file with consent status and anonymous ID |
| `telemetry-events-copilot.jsonl` | Copilot session events (JSONL format) |
| `telemetry-events-opencode.jsonl` | OpenCode session events (JSONL format) |

### View Your Data Directory

```powershell
# Show the path
Write-Host "$env:LOCALAPPDATA\atomic"

# Open in File Explorer
explorer "$env:LOCALAPPDATA\atomic"

# List telemetry files
Get-ChildItem "$env:LOCALAPPDATA\atomic\telemetry-*"
```

---

## GitHub Copilot CLI Setup

GitHub Copilot CLI integration uses PowerShell hooks to track agent usage during sessions.

### How It Works

1. **Session End Hook**: When a Copilot session ends, `.github/hooks/stop-hook.ps1` executes
2. **Agent Detection**: Parses `%USERPROFILE%\.copilot\session-state\` to detect which Atomic agents were used
3. **Event Logging**: Writes detected agents to `telemetry-events-copilot.jsonl`
4. **Background Upload**: Spawns `atomic.exe --upload-telemetry` in the background

### Copilot Session State Location

```
%USERPROFILE%\.copilot\session-state\
```

Example:
```
C:\Users\YourUsername\.copilot\session-state\
```

### Hook Configuration

Hooks are registered in `.github/hooks/hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "sessionEnd": [
      {
        "type": "command",
        "bash": "./.github/hooks/stop-hook.sh",
        "powershell": "./.github/hooks/stop-hook.ps1",
        "cwd": ".",
        "timeoutSec": 30
      }
    ]
  }
}
```

Copilot CLI automatically selects the PowerShell script on Windows.

### Verify Copilot Configuration

```powershell
# Check hooks configuration exists
Test-Path .github\hooks\hooks.json

# Check PowerShell hook exists
Test-Path .github\hooks\stop-hook.ps1

# Check telemetry helper exists
Test-Path bin\telemetry-helper.ps1
```

---

## OpenCode Setup

OpenCode uses a TypeScript plugin for telemetry, which is automatically cross-platform compatible.

### How It Works

1. **Plugin Loading**: `.opencode/plugin/telemetry.ts` loads when OpenCode starts
2. **Command Detection**: Intercepts slash commands like `/commit`, `/create-gh-pr`
3. **Session Events**: Tracks session lifecycle (`session.created`, `session.status`, `session.deleted`)
4. **Event Writing**: Writes to `telemetry-events-opencode.jsonl`
5. **Background Upload**: Spawns upload process on session end

### Verify OpenCode Configuration

```powershell
# Check plugin registration
Get-Content .opencode\opencode.json | Select-String "telemetry.ts"

# Check plugin file exists
Test-Path .opencode\plugin\telemetry.ts
```

### Expected Output

```json
"plugin": [
  "./plugin/telemetry.ts"
]
```

---

## Verification

After setup, verify telemetry is working correctly.

### 1. Check Telemetry State

```powershell
# View telemetry state file
$statePath = "$env:LOCALAPPDATA\atomic\telemetry.json"
if (Test-Path $statePath) {
    Get-Content $statePath | ConvertFrom-Json | Format-List
} else {
    Write-Host "Telemetry state file not found. Run 'atomic init' to enable telemetry."
}
```

Expected output:
```
enabled      : True
consentGiven : True
anonymousId  : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
createdAt    : 2026-01-24T10:00:00Z
rotatedAt    : 2026-01-24T10:00:00Z
```

### 2. Test Copilot Integration

```powershell
# Start a Copilot session
echo "hello" | copilot --allow-all-tools --allow-all-paths

# After session ends, check for telemetry events
Get-Content "$env:LOCALAPPDATA\atomic\telemetry-events-copilot.jsonl" | Select-Object -Last 1 | ConvertFrom-Json | Format-List
```

### 3. View Recent Events

```powershell
# View last 5 Copilot events
Get-Content "$env:LOCALAPPDATA\atomic\telemetry-events-copilot.jsonl" | Select-Object -Last 5

# View last 5 OpenCode events
Get-Content "$env:LOCALAPPDATA\atomic\telemetry-events-opencode.jsonl" | Select-Object -Last 5
```

### 4. Verify PowerShell Version in Hook

The hook script checks PowerShell version and skips telemetry on PS 5.1:

```powershell
# Check current PowerShell version
$PSVersionTable.PSVersion

# Should be 7.0 or higher for telemetry to work
```

---

## Troubleshooting

### PowerShell Execution Policy

Windows may block unsigned PowerShell scripts by default.

**Symptoms:**
- Hook scripts don't execute
- Telemetry events not written
- Error messages about execution policy

**Solution:**

Allow local scripts to run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Verify the policy:

```powershell
Get-ExecutionPolicy -List
```

Expected output should include:
```
CurrentUser       RemoteSigned
```

### Telemetry Events Not Being Written

**Check 1: Telemetry enabled**

```powershell
$env:ATOMIC_TELEMETRY      # Should NOT be "0"
$env:DO_NOT_TRACK          # Should NOT be "1"
```

**Check 2: Telemetry state file**

```powershell
$statePath = "$env:LOCALAPPDATA\atomic\telemetry.json"
Get-Content $statePath | ConvertFrom-Json
```

Should show `enabled: true` and `consentGiven: true`.

**Check 3: PowerShell version**

```powershell
$PSVersionTable.PSVersion.Major
```

Should be `7` or higher.

**Check 4: Hook script accessible**

```powershell
Test-Path .github\hooks\stop-hook.ps1
Test-Path bin\telemetry-helper.ps1
```

Both should return `True`.

### Copilot Session State Not Found

**Symptoms:**
- Agent detection fails
- Empty `commands` array in events

**Solution:**

Verify Copilot session state directory exists:

```powershell
$copilotState = "$env:USERPROFILE\.copilot\session-state"
Test-Path $copilotState

# List recent sessions
Get-ChildItem $copilotState -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 5
```

If directory doesn't exist, run at least one Copilot session first.

### atomic.exe Not Found for Upload

**Symptoms:**
- Telemetry events written but never uploaded
- Background upload process fails silently

**Solution:**

Verify `atomic.exe` is accessible:

```powershell
# Check if atomic is on PATH
Get-Command atomic -ErrorAction SilentlyContinue

# If not found, check common install locations
Test-Path "$env:USERPROFILE\.bun\bin\atomic.exe"
Test-Path "$env:APPDATA\npm\atomic.cmd"
Test-Path "$env:LOCALAPPDATA\Programs\atomic\atomic.exe"
```

If not found, reinstall Atomic or add it to your PATH.

### Debug Mode

Enable debug logging to troubleshoot issues:

```powershell
# Enable debug mode
$env:ATOMIC_TELEMETRY_DEBUG = "1"

# Run Copilot session
echo "test" | copilot --allow-all-tools

# Check for debug output in PowerShell errors
# Debug messages will appear if telemetry operations fail
```

Debug messages are written to `Write-Error` stream with prefix `[Telemetry Debug: ...]`.

---

## Privacy and Opt-Out

### What Is Collected

- Agent type used (`copilot` or `opencode`)
- Slash commands executed (`/commit`, `/create-gh-pr`, etc.)
- Command count (for usage frequency)
- Platform (`win32`)
- Atomic version
- Anonymous ID (rotated monthly)

### What Is NOT Collected

- Your code or file contents
- File paths or project names
- Prompts or queries you type
- IP addresses or location data
- Any personally identifiable information

### Opt-Out Methods

**Method 1: Using Atomic Config**

```powershell
atomic config set telemetry false
```

**Method 2: Environment Variables**

```powershell
# Temporary (current session)
$env:ATOMIC_TELEMETRY = "0"

# Permanent (user profile)
[System.Environment]::SetEnvironmentVariable("ATOMIC_TELEMETRY", "0", "User")
```

**Method 3: DO_NOT_TRACK Standard**

```powershell
# Temporary
$env:DO_NOT_TRACK = "1"

# Permanent
[System.Environment]::SetEnvironmentVariable("DO_NOT_TRACK", "1", "User")
```

### Verify Opt-Out

```powershell
# Check environment variables
Write-Host "ATOMIC_TELEMETRY: $env:ATOMIC_TELEMETRY"
Write-Host "DO_NOT_TRACK: $env:DO_NOT_TRACK"

# Check state file
Get-Content "$env:LOCALAPPDATA\atomic\telemetry.json" | ConvertFrom-Json
```

If opted out, `enabled` should be `false`.

### Delete Existing Telemetry Data

```powershell
# Remove all telemetry files
Remove-Item "$env:LOCALAPPDATA\atomic\telemetry*.jsonl" -Force

# Optionally remove state file (resets consent)
Remove-Item "$env:LOCALAPPDATA\atomic\telemetry.json" -Force
```

---

## Advanced Configuration

### Custom Data Directory

You can customize where telemetry data is stored (not recommended):

```powershell
# Note: This is not officially supported and may break in future versions
# The telemetry helper uses $env:LOCALAPPDATA by default
```

### Manual Event Inspection

View the structure of telemetry events:

```powershell
# Pretty-print the last event
$lastEvent = Get-Content "$env:LOCALAPPDATA\atomic\telemetry-events-copilot.jsonl" | Select-Object -Last 1
$lastEvent | ConvertFrom-Json | ConvertTo-Json -Depth 10

# Count total events
(Get-Content "$env:LOCALAPPDATA\atomic\telemetry-events-copilot.jsonl").Count
```

Example event structure:

```json
{
  "anonymousId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "eventId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "sessionId": "yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy",
  "eventType": "agent_session",
  "timestamp": "2026-01-24T10:30:00Z",
  "agentType": "copilot",
  "commands": ["/commit", "/create-gh-pr"],
  "commandCount": 2,
  "platform": "win32",
  "atomicVersion": "1.0.0",
  "source": "session_hook"
}
```

---

## Support

If you encounter issues not covered by this guide:

1. **Enable debug mode**: `$env:ATOMIC_TELEMETRY_DEBUG = "1"`
2. **Run a test session** and capture any error output
3. **File an issue** at: https://github.com/flora131/atomic/issues

Include:
- PowerShell version (`$PSVersionTable.PSVersion`)
- Windows version (`$PSVersionTable.OS`)
- Atomic version (`atomic --version`)
- Any error messages or unexpected behavior
