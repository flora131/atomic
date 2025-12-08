param(
    [switch]$Help,
    [int]$MaxIterations = 0,
    [string]$CompletionMarker = "<promise>COMPLETE</promise>"
)

function Show-Usage {
    @"
Usage: ./.claude/.ralph/ralph.ps1 [-Help] [-MaxIterations <int>] [-CompletionMarker <string>]

  -Help               Show this message
  -MaxIterations      Number of loop iterations (0 = infinite, default: 0)
    -CompletionMarker   Marker to stop after detecting in .claude/.ralph/claude_output.jsonl
                                            (default: <promise>COMPLETE</promise>)
"@
}

if ($Help) {
    Show-Usage
    exit 0
}

$OutputLog = ".claude/.ralph/claude_output.jsonl"

function CheckCompletion {
    param(
        [string]$Path,
        [string]$Marker
    )

    if (-not (Test-Path $Path -PathType Leaf)) {
        return $false
    }

    return Select-String -Path $Path -Pattern ([regex]::Escape($Marker)) -Quiet
}

if ($MaxIterations -gt 0) {
    for ($i = 1; $i -le $MaxIterations; $i++) {
        Write-Host "Iteration: $i / $MaxIterations"
        & ./.claude/.ralph/sync.ps1
        if (CheckCompletion -Path $OutputLog -Marker $CompletionMarker) {
            Write-Host "Completion promise detected. Exiting loop."
            break
        }
        Write-Host "===SLEEP===`n===SLEEP===`n"
        Write-Host "looping"
        Start-Sleep -Seconds 10
    }
} else {
    while ($true) {
        & ./.claude/.ralph/sync.ps1
        if (CheckCompletion -Path $OutputLog -Marker $CompletionMarker) {
            Write-Host "Completion promise detected. Exiting loop."
            break
        }
        Write-Host "===SLEEP===`n===SLEEP===`n"
        Write-Host "looping"
        Start-Sleep -Seconds 10
    }
}
