/**
 * Zsh completion script for the atomic CLI.
 *
 * Install: eval "$(atomic completions zsh)"
 */
export const zshCompletionScript = `
#compdef atomic

_atomic() {
    local -a agents=('claude' 'opencode' 'copilot')
    local -a scms=('github' 'sapling')

    _arguments -C \\
        '(-y --yes)'{-y,--yes}'[Auto-confirm all prompts]' \\
        '--no-banner[Skip ASCII banner display]' \\
        '(-v --version)'{-v,--version}'[Show version number]' \\
        '(-h --help)'{-h,--help}'[Show help]' \\
        '1:command:->cmds' \\
        '*::arg:->args'

    case "$state" in
        cmds)
            local -a commands=(
                'init:Interactive setup with agent selection'
                'chat:Start an interactive chat session'
                'workflow:Run a multi-session agent workflow'
                'session:Manage running tmux sessions'
                'config:Manage atomic configuration'
                'completions:Output shell completion script'
            )
            _describe 'command' commands
            ;;
        args)
            case "\${words[1]}" in
                init)
                    _arguments \\
                        '(-a --agent)'{-a,--agent}'[Agent to configure]:agent:(claude opencode copilot)' \\
                        '(-s --scm)'{-s,--scm}'[Source control system]:scm:(github sapling)' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                chat)
                    _arguments -C \\
                        '(-a --agent)'{-a,--agent}'[Agent to chat with]:agent:(claude opencode copilot)' \\
                        '(-h --help)'{-h,--help}'[Show help]' \\
                        '1:subcommand:->sub' \\
                        '*::subarg:->subargs'
                    case "$state" in
                        sub)
                            local -a subs=('session:Manage running chat sessions')
                            _describe 'subcommand' subs
                            ;;
                        subargs)
                            case "\${words[1]}" in
                                session) _atomic_session ;;
                            esac
                            ;;
                    esac
                    ;;
                workflow)
                    _arguments -C \\
                        '(-n --name)'{-n,--name}'[Workflow name]:name:' \\
                        '(-a --agent)'{-a,--agent}'[Agent to use]:agent:(claude opencode copilot)' \\
                        '(-h --help)'{-h,--help}'[Show help]' \\
                        '1:subcommand:->sub' \\
                        '*::subarg:->subargs'
                    case "$state" in
                        sub)
                            local -a subs=(
                                'list:List available workflows'
                                'session:Manage running workflow sessions'
                            )
                            _describe 'subcommand' subs
                            ;;
                        subargs)
                            case "\${words[1]}" in
                                list)
                                    _arguments \\
                                        '(-a --agent)'{-a,--agent}'[Filter by agent]:agent:(claude opencode copilot)' \\
                                        '(-h --help)'{-h,--help}'[Show help]'
                                    ;;
                                session) _atomic_session ;;
                            esac
                            ;;
                    esac
                    ;;
                session)
                    _atomic_session
                    ;;
                config)
                    _arguments -C \\
                        '(-h --help)'{-h,--help}'[Show help]' \\
                        '1:subcommand:->sub' \\
                        '*::subarg:->subargs'
                    case "$state" in
                        sub)
                            local -a subs=('set:Set a configuration value')
                            _describe 'subcommand' subs
                            ;;
                        subargs)
                            case "\${words[1]}" in
                                set)
                                    _arguments \\
                                        '1:key:(telemetry)' \\
                                        '2:value:(true false)'
                                    ;;
                            esac
                            ;;
                    esac
                    ;;
                completions)
                    _arguments '1:shell:(bash zsh fish powershell)'
                    ;;
            esac
            ;;
    esac
}

_atomic_session() {
    _arguments -C \\
        '(-h --help)'{-h,--help}'[Show help]' \\
        '1:subcommand:->sub' \\
        '*::subarg:->subargs'
    case "$state" in
        sub)
            local -a subs=(
                'list:List running sessions'
                'connect:Attach to a running session'
                'kill:Kill a running session (omit id to kill all)'
            )
            _describe 'subcommand' subs
            ;;
        subargs)
            case "\${words[1]}" in
                list|connect|kill)
                    _arguments \\
                        '*'{-a,--agent}'[Filter by agent]:agent:(claude opencode copilot)' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
            esac
            ;;
    esac
}

compdef _atomic atomic
`;
