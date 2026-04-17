/**
 * Bash completion script for the atomic CLI.
 *
 * Install: eval "$(atomic completions bash)"
 */
export const bashCompletionScript = `
_atomic_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="init chat workflow session config completions"
    local agents="claude opencode copilot"
    local scms="github sapling"
    local global_opts="-y --yes --no-banner -v --version -h --help"

    # Walk the words to find the command chain (skip flags and their values)
    local cmd1="" cmd2="" cmd3=""
    local i=1
    while [[ $i -lt $cword ]]; do
        local w="\${words[$i]}"
        case "$w" in
            -a|--agent|-s|--scm|-n|--name) (( i++ )) ;;  # skip flag value
            -*)                            ;;              # skip other flags
            *)
                if [[ -z "$cmd1" ]]; then cmd1="$w"
                elif [[ -z "$cmd2" ]]; then cmd2="$w"
                elif [[ -z "$cmd3" ]]; then cmd3="$w"
                fi
                ;;
        esac
        (( i++ ))
    done

    # Complete flag values
    case "$prev" in
        -a|--agent)
            COMPREPLY=( $(compgen -W "$agents" -- "$cur") )
            return
            ;;
        -s|--scm)
            COMPREPLY=( $(compgen -W "$scms" -- "$cur") )
            return
            ;;
    esac

    # Top-level (no subcommand yet)
    if [[ -z "$cmd1" ]]; then
        COMPREPLY=( $(compgen -W "$commands $global_opts" -- "$cur") )
        return
    fi

    case "$cmd1" in
        init)
            COMPREPLY=( $(compgen -W "-a --agent -s --scm -h --help" -- "$cur") )
            ;;
        chat)
            if [[ -z "$cmd2" ]]; then
                COMPREPLY=( $(compgen -W "session -a --agent -h --help" -- "$cur") )
            elif [[ "$cmd2" == "session" ]]; then
                if [[ -z "$cmd3" ]]; then
                    COMPREPLY=( $(compgen -W "list connect kill -h --help" -- "$cur") )
                else
                    COMPREPLY=( $(compgen -W "-a --agent -h --help" -- "$cur") )
                fi
            fi
            ;;
        workflow)
            if [[ -z "$cmd2" ]]; then
                COMPREPLY=( $(compgen -W "list session -n --name -a --agent -h --help" -- "$cur") )
            elif [[ "$cmd2" == "list" ]]; then
                COMPREPLY=( $(compgen -W "-a --agent -h --help" -- "$cur") )
            elif [[ "$cmd2" == "session" ]]; then
                if [[ -z "$cmd3" ]]; then
                    COMPREPLY=( $(compgen -W "list connect kill -h --help" -- "$cur") )
                else
                    COMPREPLY=( $(compgen -W "-a --agent -h --help" -- "$cur") )
                fi
            fi
            ;;
        session)
            if [[ -z "$cmd2" ]]; then
                COMPREPLY=( $(compgen -W "list connect kill -h --help" -- "$cur") )
            else
                COMPREPLY=( $(compgen -W "-a --agent -h --help" -- "$cur") )
            fi
            ;;
        config)
            if [[ -z "$cmd2" ]]; then
                COMPREPLY=( $(compgen -W "set -h --help" -- "$cur") )
            elif [[ "$cmd2" == "set" ]]; then
                if [[ -z "$cmd3" ]]; then
                    COMPREPLY=( $(compgen -W "telemetry" -- "$cur") )
                else
                    case "$cmd3" in
                        telemetry) COMPREPLY=( $(compgen -W "true false" -- "$cur") ) ;;
                    esac
                fi
            fi
            ;;
        completions)
            COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") )
            ;;
    esac
}

complete -F _atomic_completions atomic
`;
