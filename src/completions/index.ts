export { bashCompletionScript } from "./bash.ts";
export { zshCompletionScript } from "./zsh.ts";
export { fishCompletionScript } from "./fish.ts";
export { powershellCompletionScript } from "./powershell.ts";

export const SUPPORTED_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;
export type Shell = (typeof SUPPORTED_SHELLS)[number];
