param(
    [int]$MaxIterations = 0
)

$count = 0

while ($true) {
    if ($MaxIterations -gt 0 -and $count -ge $MaxIterations) {
        Write-Host "Reached max iterations ($MaxIterations)"
        break
    }
    $count++
    Write-Host "Iteration: $count"

    $isComplete = & .\.ralph\sync.ps1
    
    # Check if completion marker was found
    if ($isComplete -eq $true) {
        Write-Host "===COMPLETE===" -ForegroundColor Green
        Write-Host "Detected <promise>COMPLETE</promise> - exiting loop"
        break
    }
    
    Write-Host "===SLEEP==="
    Write-Host "===SLEEP==="
    Write-Host ""
    Write-Host "looping"
    Start-Sleep -Seconds 10
}
