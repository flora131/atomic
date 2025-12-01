param(
    [int]$MaxIterations = 0
)

if ($MaxIterations -gt 0) {
    for ($i = 1; $i -le $MaxIterations; $i++) {
        Write-Host "Iteration: $i / $MaxIterations"
        & .\.ralph\sync.ps1
        Write-Host "===SLEEP===`n===SLEEP===`n"
        Write-Host "looping"
        Start-Sleep -Seconds 10
    }
} else {
    while ($true) {
        & .\.ralph\sync.ps1
        Write-Host "===SLEEP===`n===SLEEP===`n"
        Write-Host "looping"
        Start-Sleep -Seconds 10
    }
}
