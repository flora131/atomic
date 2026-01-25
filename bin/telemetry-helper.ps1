#!/usr/bin/env pwsh
#Requires -Version 7.0

# Set error preference for silent failures (telemetry must never break the application)
$ErrorActionPreference = 'SilentlyContinue'

<#
.SYNOPSIS
    Telemetry Helper Script for Agent Hooks (PowerShell 7.x)

.DESCRIPTION
    Provides functions for writing agent session telemetry events.
    Dot-source this script from agent-specific hooks.

.EXAMPLE
    . "$PSScriptRoot/../../bin/telemetry-helper.ps1"
    Write-SessionEvent -AgentType "copilot" -Commands @('/commit', '/create-gh-pr')

.NOTES
    Reference: Spec Section 5.3.3

    IMPORTANT: Code Duplication
    This script duplicates logic from TypeScript modules in src/utils/telemetry/
    This is INTENTIONAL - PowerShell hooks cannot practically import TypeScript at runtime.
    When modifying telemetry logic, update all locations:
      - TypeScript source of truth: src/utils/telemetry/
      - Bash implementation: bin/telemetry-helper.sh
      - PowerShell implementation: bin/telemetry-helper.ps1
#>

# Atomic commands to track
# Source of truth: src/utils/telemetry/constants.ts
# Keep synchronized when adding/removing commands
$script:AtomicCommands = @(
    '/research-codebase'
    '/create-spec'
    '/create-feature-list'
    '/implement-feature'
    '/commit'
    '/create-gh-pr'
    '/explain-code'
    '/ralph-loop'
    '/ralph:ralph-loop'
    '/cancel-ralph'
    '/ralph:cancel-ralph'
    '/ralph-help'
    '/ralph:help'
)

<#
.SYNOPSIS
    Get the telemetry data directory

.DESCRIPTION
    Returns the platform-specific data directory path for telemetry files.
    Source of truth: src/utils/config-path.ts getBinaryDataDir()

.OUTPUTS
    System.String - Path to telemetry data directory
#>
function Get-TelemetryDataDir {
    if ($IsWindows) {
        $appData = $env:LOCALAPPDATA
        if (-not $appData) {
            $appData = Join-Path $env:USERPROFILE 'AppData\Local'
        }
        return Join-Path $appData 'atomic'
    } else {
        # Unix/macOS (cross-platform PowerShell)
        $xdgData = $env:XDG_DATA_HOME
        if (-not $xdgData) {
            $xdgData = Join-Path $env:HOME '.local/share'
        }
        return Join-Path $xdgData 'atomic'
    }
}

<#
.SYNOPSIS
    Get the path to the JSONL events file for a specific agent type

.PARAMETER AgentType
    The agent type: "claude", "opencode", or "copilot"

.OUTPUTS
    System.String - Path to telemetry-events-{agent}.jsonl
#>
function Get-EventsFilePath {
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet('claude', 'opencode', 'copilot')]
        [string]$AgentType
    )

    $dataDir = Get-TelemetryDataDir
    return Join-Path $dataDir "telemetry-events-$AgentType.jsonl"
}

<#
.SYNOPSIS
    Get the path to the telemetry.json state file

.OUTPUTS
    System.String - Path to telemetry.json
#>
function Get-TelemetryStatePath {
    $dataDir = Get-TelemetryDataDir
    return Join-Path $dataDir 'telemetry.json'
}

<#
.SYNOPSIS
    Check if telemetry collection is enabled

.DESCRIPTION
    Checks environment variables and state file to determine if telemetry is enabled.
    Returns $false if:
      - ATOMIC_TELEMETRY=0
      - DO_NOT_TRACK=1
      - State file doesn't exist
      - enabled=false or consentGiven=false in state file

.OUTPUTS
    System.Boolean - $true if telemetry is enabled, $false otherwise
#>
function Test-TelemetryEnabled {
    # Check environment variables
    if ($env:ATOMIC_TELEMETRY -eq '0') {
        return $false
    }

    if ($env:DO_NOT_TRACK -eq '1') {
        return $false
    }

    $statePath = Get-TelemetryStatePath
    if (-not (Test-Path $statePath)) {
        return $false
    }

    try {
        $state = Get-Content -Raw -Path $statePath -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        return ($state.enabled -eq $true) -and ($state.consentGiven -eq $true)
    } catch {
        # Silent failure on invalid JSON or missing file
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry Debug: Test-TelemetryEnabled] $_"
        }
        return $false
    }
}

<#
.SYNOPSIS
    Get the anonymous ID from the telemetry state file

.OUTPUTS
    System.String - Anonymous ID (UUID v4) or $null if not available
#>
function Get-AnonymousId {
    $statePath = Get-TelemetryStatePath
    if (-not (Test-Path $statePath)) {
        return $null
    }

    try {
        $state = Get-Content -Raw -Path $statePath -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
        return $state.anonymousId
    } catch {
        # Silent failure on invalid JSON or missing file
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry Debug: Get-AnonymousId] $_"
        }
        return $null
    }
}

<#
.SYNOPSIS
    Get the Atomic CLI version

.OUTPUTS
    System.String - Version string or "unknown"
#>
function Get-AtomicVersion {
    try {
        $atomic = Get-Command 'atomic' -ErrorAction SilentlyContinue
        if ($atomic) {
            $version = & $atomic.Source --version 2>$null
            if ($version) {
                return $version.Trim()
            }
        }
    } catch {
        # Silent failure - return unknown
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry Debug: Get-AtomicVersion] $_"
        }
    }

    return 'unknown'
}

<#
.SYNOPSIS
    Get the normalized platform name

.OUTPUTS
    System.String - "win32", "darwin", "linux", or "unknown"
#>
function Get-Platform {
    if ($IsWindows) { return 'win32' }
    if ($IsMacOS)   { return 'darwin' }
    if ($IsLinux)   { return 'linux' }
    return 'unknown'
}

<#
.SYNOPSIS
    Extract Atomic slash commands from text

.DESCRIPTION
    Searches for Atomic commands in the input text using regex pattern matching.
    Counts all occurrences to preserve usage frequency.

.PARAMETER Text
    The text to search for commands

.OUTPUTS
    System.String[] - Array of found commands (may contain duplicates)

.EXAMPLE
    Find-AtomicCommands -Text "Please /commit the changes and /create-gh-pr"
    # Returns: @('/commit', '/create-gh-pr')
#>
function Find-AtomicCommands {
    param(
        [Parameter(Mandatory=$true)]
        [string]$Text
    )

    $foundCommands = @()

    foreach ($cmd in $script:AtomicCommands) {
        # Escape special regex characters in command
        $escapedCmd = [regex]::Escape($cmd)

        # Match command with word boundaries
        # Pattern: command must be preceded by start of line, whitespace, or non-word/slash char
        #          and followed by whitespace, end of line, or non-word/underscore/dash char
        $pattern = "(?:^|\s|[^\w/-])($escapedCmd)(?:\s|$|[^\w_-])"

        $matches = [regex]::Matches($Text, $pattern)
        foreach ($match in $matches) {
            $foundCommands += $match.Groups[1].Value
        }
    }

    return $foundCommands
}

<#
.SYNOPSIS
    Write an agent session telemetry event to JSONL file

.DESCRIPTION
    Creates and appends a telemetry event to the agent-specific JSONL file.
    Event structure matches AgentSessionEvent interface from TypeScript.

.PARAMETER AgentType
    The agent type: "claude", "opencode", or "copilot"

.PARAMETER Commands
    Array of Atomic commands used in the session

.PARAMETER SessionStartedAt
    Optional session start timestamp (ISO 8601). If not provided, uses current time.

.OUTPUTS
    None

.EXAMPLE
    Write-SessionEvent -AgentType "copilot" -Commands @('/commit', '/create-gh-pr')
#>
function Write-SessionEvent {
    param(
        [Parameter(Mandatory=$true)]
        [ValidateSet('claude', 'opencode', 'copilot')]
        [string]$AgentType,

        [Parameter(Mandatory=$true)]
        [AllowEmptyCollection()]
        [string[]]$Commands,

        [Parameter(Mandatory=$false)]
        [string]$SessionStartedAt
    )

    # Early exit if telemetry not enabled
    if (-not (Test-TelemetryEnabled)) {
        return
    }

    # Early exit if no commands
    if (-not $Commands -or $Commands.Count -eq 0) {
        return
    }

    # Get anonymous ID
    $anonymousId = Get-AnonymousId
    if (-not $anonymousId) {
        return
    }

    # Generate event data
    $eventId = [guid]::NewGuid().ToString()
    $timestamp = if ($SessionStartedAt) {
        $SessionStartedAt
    } else {
        (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }

    # Create event object matching AgentSessionEvent interface
    $event = [PSCustomObject]@{
        anonymousId   = $anonymousId
        eventId       = $eventId
        sessionId     = $eventId  # sessionId same as eventId for agent_session events
        eventType     = 'agent_session'
        timestamp     = $timestamp
        agentType     = $AgentType
        commands      = $Commands
        commandCount  = $Commands.Count
        platform      = Get-Platform
        atomicVersion = Get-AtomicVersion
        source        = 'session_hook'
    }

    # Get events file path
    $eventsFile = Get-EventsFilePath -AgentType $AgentType
    $eventsDir = Split-Path -Parent $eventsFile

    # Ensure directory exists
    if (-not (Test-Path $eventsDir)) {
        try {
            New-Item -ItemType Directory -Path $eventsDir -Force -ErrorAction Stop | Out-Null
        } catch {
            # Silent failure if directory creation fails
            return
        }
    }

    # Convert to compact JSON (single line for JSONL)
    try {
        $jsonLine = $event | ConvertTo-Json -Compress -Depth 10 -ErrorAction Stop
        Add-Content -Path $eventsFile -Value $jsonLine -Encoding UTF8 -ErrorAction Stop
    } catch {
        # Silent failure if write fails (telemetry must never break the application)
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry Debug: Write-SessionEvent] Failed to write event: $_"
        }
    }
}

<#
.SYNOPSIS
    Spawn background process to upload telemetry

.DESCRIPTION
    Starts a detached atomic --upload-telemetry process in the background.
    Process runs independently and doesn't block the hook script.

.OUTPUTS
    None
#>
function Start-TelemetryUpload {
    # Find atomic executable
    $atomicCmd = Get-Command 'atomic' -ErrorAction SilentlyContinue
    if (-not $atomicCmd) {
        # Fallback: try common installation paths
        $possiblePaths = @(
            "$env:USERPROFILE\.bun\bin\atomic.exe"
            "$env:APPDATA\npm\atomic.cmd"
            "$env:USERPROFILE\scoop\shims\atomic.exe"
        )

        foreach ($path in $possiblePaths) {
            if (Test-Path $path) {
                $atomicCmd = Get-Command $path -ErrorAction SilentlyContinue
                break
            }
        }
    }

    if (-not $atomicCmd) {
        # atomic not found - silent failure
        return
    }

    try {
        if ($IsWindows) {
            # Windows: Start-Process creates independent process
            Start-Process -FilePath $atomicCmd.Source `
                         -ArgumentList '--upload-telemetry' `
                         -WindowStyle Hidden `
                         -ErrorAction Stop | Out-Null
        } else {
            # Unix/macOS: Use nohup to detach from terminal
            Start-Process -FilePath 'nohup' `
                         -ArgumentList @($atomicCmd.Source, '--upload-telemetry') `
                         -ErrorAction Stop | Out-Null
        }
    } catch {
        # Silent failure if process spawn fails (telemetry must never break the application)
        if ($env:ATOMIC_TELEMETRY_DEBUG -eq '1') {
            Write-Error "[Telemetry Debug: Start-TelemetryUpload] Failed to spawn upload: $_"
        }
    }
}

# Export functions for dot-sourcing
Export-ModuleMember -Function @(
    'Get-TelemetryDataDir'
    'Get-EventsFilePath'
    'Get-TelemetryStatePath'
    'Test-TelemetryEnabled'
    'Get-AnonymousId'
    'Get-AtomicVersion'
    'Get-Platform'
    'Find-AtomicCommands'
    'Write-SessionEvent'
    'Start-TelemetryUpload'
)
