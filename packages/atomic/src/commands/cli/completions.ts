import {
    bashCompletionScript,
    zshCompletionScript,
    fishCompletionScript,
    powershellCompletionScript,
    type Shell,
} from "../../completions/index.ts";

const SCRIPTS: Record<Shell, string> = {
    bash: bashCompletionScript,
    zsh: zshCompletionScript,
    fish: fishCompletionScript,
    powershell: powershellCompletionScript,
};

/**
 * Print the shell completion script for the given shell to stdout.
 * Returns 0 on success, 1 on unknown shell.
 */
export function completionsCommand(shell: Shell): number {
    const script = SCRIPTS[shell];
    process.stdout.write(script);
    return 0;
}
