/**
 * Submit Handler — Composer Submit Logic
 *
 * Re-exports the composer submit handler for discoverability within
 * the keyboard module. The submit function handles slash-command
 * parsing, message queueing, and workflow input resolution.
 *
 * @module
 */

export { handleComposerSubmit } from "@/state/chat/composer/submit.ts";
