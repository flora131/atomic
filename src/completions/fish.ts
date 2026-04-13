/**
 * Fish completion script for the atomic CLI.
 *
 * Install: atomic completions fish | source
 *   or:   atomic completions fish > ~/.config/fish/completions/atomic.fish
 */
export const fishCompletionScript = `
# Disable file completions by default
complete -c atomic -f

# ── Helpers ─────────────────────────────────────────────────────────────────

set -l agents claude opencode copilot
set -l scms github sapling

# Condition helpers — true when the command line matches a specific depth.
# "__fish_seen_subcommand_from X" is true once token X has appeared.

function __atomic_no_subcommand
    not __fish_seen_subcommand_from init chat workflow session config completions
end

function __atomic_using_cmd
    set -l cmds $argv
    set -l tokens (commandline -opc)
    # Check that the command sequence matches
    set -l idx 2  # start after 'atomic'
    for cmd in $cmds
        if test $idx -gt (count $tokens)
            return 1
        end
        # Skip flags and their values
        while test $idx -le (count $tokens)
            switch $tokens[$idx]
                case '-*'
                    set idx (math $idx + 1)
                    # Skip flag value for known value-flags
                    switch $tokens[(math $idx - 1)]
                        case -a --agent -s --scm -n --name
                            set idx (math $idx + 1)
                    end
                case '*'
                    break
            end
        end
        if test $idx -gt (count $tokens)
            return 1
        end
        if test "$tokens[$idx]" != "$cmd"
            return 1
        end
        set idx (math $idx + 1)
    end
    return 0
end

function __atomic_needs_subcmd_of
    __atomic_using_cmd $argv
    and not __fish_seen_subcommand_from list connect set
end

# ── Global options ──────────────────────────────────────────────────────────

complete -c atomic -n __atomic_no_subcommand -s y -l yes -d 'Auto-confirm all prompts'
complete -c atomic -n __atomic_no_subcommand -l no-banner -d 'Skip ASCII banner display'
complete -c atomic -n __atomic_no_subcommand -s v -l version -d 'Show version number'
complete -c atomic -n __atomic_no_subcommand -s h -l help -d 'Show help'

# ── Top-level subcommands ───────────────────────────────────────────────────

complete -c atomic -n __atomic_no_subcommand -a init -d 'Interactive setup with agent selection'
complete -c atomic -n __atomic_no_subcommand -a chat -d 'Start an interactive chat session'
complete -c atomic -n __atomic_no_subcommand -a workflow -d 'Run a multi-session agent workflow'
complete -c atomic -n __atomic_no_subcommand -a session -d 'Manage running tmux sessions'
complete -c atomic -n __atomic_no_subcommand -a config -d 'Manage atomic configuration'
complete -c atomic -n __atomic_no_subcommand -a completions -d 'Output shell completion script'

# ── init ────────────────────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd init' -s a -l agent -d 'Agent to configure' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd init' -s s -l scm -d 'Source control system' -r -a "$scms"

# ── chat ────────────────────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd chat; and not __fish_seen_subcommand_from session' -s a -l agent -d 'Agent to chat with' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd chat; and not __fish_seen_subcommand_from session' -a session -d 'Manage running chat sessions'

# chat session
complete -c atomic -n '__atomic_using_cmd chat session; and not __fish_seen_subcommand_from list connect' -a list -d 'List running sessions'
complete -c atomic -n '__atomic_using_cmd chat session; and not __fish_seen_subcommand_from list connect' -a connect -d 'Attach to a running session'
complete -c atomic -n '__atomic_using_cmd chat session list' -s a -l agent -d 'Filter by agent' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd chat session connect' -s a -l agent -d 'Filter by agent' -r -a "$agents"

# ── workflow ────────────────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd workflow; and not __fish_seen_subcommand_from list session' -s n -l name -d 'Workflow name' -r
complete -c atomic -n '__atomic_using_cmd workflow; and not __fish_seen_subcommand_from list session' -s a -l agent -d 'Agent to use' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd workflow; and not __fish_seen_subcommand_from list session' -a list -d 'List available workflows'
complete -c atomic -n '__atomic_using_cmd workflow; and not __fish_seen_subcommand_from list session' -a session -d 'Manage running workflow sessions'

# workflow list
complete -c atomic -n '__atomic_using_cmd workflow list' -s a -l agent -d 'Filter by agent' -r -a "$agents"

# workflow session
complete -c atomic -n '__atomic_using_cmd workflow session; and not __fish_seen_subcommand_from list connect' -a list -d 'List running sessions'
complete -c atomic -n '__atomic_using_cmd workflow session; and not __fish_seen_subcommand_from list connect' -a connect -d 'Attach to a running session'
complete -c atomic -n '__atomic_using_cmd workflow session list' -s a -l agent -d 'Filter by agent' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd workflow session connect' -s a -l agent -d 'Filter by agent' -r -a "$agents"

# ── session (top-level) ────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd session; and not __fish_seen_subcommand_from list connect' -a list -d 'List running sessions'
complete -c atomic -n '__atomic_using_cmd session; and not __fish_seen_subcommand_from list connect' -a connect -d 'Attach to a running session'
complete -c atomic -n '__atomic_using_cmd session list' -s a -l agent -d 'Filter by agent' -r -a "$agents"
complete -c atomic -n '__atomic_using_cmd session connect' -s a -l agent -d 'Filter by agent' -r -a "$agents"

# ── config ──────────────────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd config; and not __fish_seen_subcommand_from set' -a set -d 'Set a configuration value'
complete -c atomic -n '__atomic_using_cmd config set; and not __fish_seen_subcommand_from telemetry' -a telemetry -d 'Telemetry setting'
complete -c atomic -n '__atomic_using_cmd config set telemetry' -a 'true false'

# ── completions ─────────────────────────────────────────────────────────────

complete -c atomic -n '__atomic_using_cmd completions' -a 'bash zsh fish powershell' -d 'Shell type'
`;
