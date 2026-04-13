/**
 * PowerShell completion script for the atomic CLI (Windows / cross-platform).
 *
 * Install: atomic completions powershell | Invoke-Expression
 *   or add to $PROFILE for persistence.
 */
export const powershellCompletionScript = `
Register-ArgumentCompleter -Native -CommandName atomic -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $tokens = $commandAst.ToString().Substring(0, $cursorPosition) -split '\\s+' |
        Where-Object { $_ -ne '' }

    $agents  = @('claude', 'opencode', 'copilot')
    $scms    = @('github', 'sapling')
    $shells  = @('bash', 'zsh', 'fish', 'powershell')

    # Parse command chain, skipping flags and their values
    $cmds = @()
    $skipNext = $false
    $prevToken = ''
    for ($i = 1; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i]
        if ($skipNext) { $skipNext = $false; continue }
        if ($t -match '^-') {
            if ($t -match '^(-a|--agent|-s|--scm|-n|--name)$') { $skipNext = $true }
            $prevToken = $t
            continue
        }
        $cmds += $t
    }

    # Check if the previous non-word token is a value-expecting flag
    $lastToken = if ($tokens.Count -gt 1) { $tokens[-1] } else { '' }
    $prevFullToken = if ($tokens.Count -gt 2) { $tokens[-2] } else { '' }

    # Complete flag values
    if ($prevFullToken -match '^(-a|--agent)$' -or $lastToken -match '^(-a|--agent)$') {
        if ($lastToken -match '^(-a|--agent)$') {
            $agents | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
            return
        }
        $agents | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }
    if ($prevFullToken -match '^(-s|--scm)$' -or $lastToken -match '^(-s|--scm)$') {
        if ($lastToken -match '^(-s|--scm)$') {
            $scms | ForEach-Object {
                [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
            }
            return
        }
        $scms | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
        return
    }

    $completions = @()

    switch ($cmds.Count) {
        0 {
            # Top-level commands
            $completions = @(
                @{ text = 'init';        tip = 'Interactive setup with agent selection' }
                @{ text = 'chat';        tip = 'Start an interactive chat session' }
                @{ text = 'workflow';    tip = 'Run a multi-session agent workflow' }
                @{ text = 'session';     tip = 'Manage running tmux sessions' }
                @{ text = 'config';      tip = 'Manage atomic configuration' }
                @{ text = 'completions'; tip = 'Output shell completion script' }
            )
        }
        default {
            switch ($cmds[0]) {
                'init' {
                    $completions = @(
                        @{ text = '-a';      tip = 'Agent to configure' }
                        @{ text = '--agent'; tip = 'Agent to configure' }
                        @{ text = '-s';      tip = 'Source control system' }
                        @{ text = '--scm';   tip = 'Source control system' }
                    )
                }
                'chat' {
                    if ($cmds.Count -eq 1) {
                        $completions = @(
                            @{ text = 'session'; tip = 'Manage running chat sessions' }
                            @{ text = '-a';      tip = 'Agent to chat with' }
                            @{ text = '--agent'; tip = 'Agent to chat with' }
                        )
                    } elseif ($cmds[1] -eq 'session') {
                        if ($cmds.Count -eq 2) {
                            $completions = @(
                                @{ text = 'list';    tip = 'List running sessions' }
                                @{ text = 'connect'; tip = 'Attach to a running session' }
                            )
                        } else {
                            $completions = @(
                                @{ text = '-a';      tip = 'Filter by agent' }
                                @{ text = '--agent'; tip = 'Filter by agent' }
                            )
                        }
                    }
                }
                'workflow' {
                    if ($cmds.Count -eq 1) {
                        $completions = @(
                            @{ text = 'list';    tip = 'List available workflows' }
                            @{ text = 'session'; tip = 'Manage running workflow sessions' }
                            @{ text = '-n';      tip = 'Workflow name' }
                            @{ text = '--name';  tip = 'Workflow name' }
                            @{ text = '-a';      tip = 'Agent to use' }
                            @{ text = '--agent'; tip = 'Agent to use' }
                        )
                    } elseif ($cmds[1] -eq 'list') {
                        $completions = @(
                            @{ text = '-a';      tip = 'Filter by agent' }
                            @{ text = '--agent'; tip = 'Filter by agent' }
                        )
                    } elseif ($cmds[1] -eq 'session') {
                        if ($cmds.Count -eq 2) {
                            $completions = @(
                                @{ text = 'list';    tip = 'List running sessions' }
                                @{ text = 'connect'; tip = 'Attach to a running session' }
                            )
                        } else {
                            $completions = @(
                                @{ text = '-a';      tip = 'Filter by agent' }
                                @{ text = '--agent'; tip = 'Filter by agent' }
                            )
                        }
                    }
                }
                'session' {
                    if ($cmds.Count -eq 1) {
                        $completions = @(
                            @{ text = 'list';    tip = 'List running sessions' }
                            @{ text = 'connect'; tip = 'Attach to a running session' }
                        )
                    } else {
                        $completions = @(
                            @{ text = '-a';      tip = 'Filter by agent' }
                            @{ text = '--agent'; tip = 'Filter by agent' }
                        )
                    }
                }
                'config' {
                    if ($cmds.Count -eq 1) {
                        $completions = @(
                            @{ text = 'set'; tip = 'Set a configuration value' }
                        )
                    } elseif ($cmds[1] -eq 'set') {
                        if ($cmds.Count -eq 2) {
                            $completions = @(
                                @{ text = 'telemetry'; tip = 'Telemetry setting' }
                            )
                        } elseif ($cmds[2] -eq 'telemetry') {
                            $completions = @(
                                @{ text = 'true';  tip = 'Enable telemetry' }
                                @{ text = 'false'; tip = 'Disable telemetry' }
                            )
                        }
                    }
                }
                'completions' {
                    $completions = @(
                        @{ text = 'bash';       tip = 'Bash completion script' }
                        @{ text = 'zsh';        tip = 'Zsh completion script' }
                        @{ text = 'fish';       tip = 'Fish completion script' }
                        @{ text = 'powershell'; tip = 'PowerShell completion script' }
                    )
                }
            }
        }
    }

    $completions | Where-Object { $_.text -like "$wordToComplete*" } | ForEach-Object {
        [System.Management.Automation.CompletionResult]::new($_.text, $_.text, 'ParameterValue', $_.tip)
    }
}
`;
