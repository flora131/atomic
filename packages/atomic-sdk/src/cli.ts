#!/usr/bin/env bun
/**
 * SDK-bundled internal CLI dispatcher entry point.
 *
 * Spawned by the SDK's host-bun resolver as `<bun> <this-script>
 * _orchestrator-entry|_cc-debounce <args>` whenever `runWorkflow` is
 * called from a host that ships at a real on-disk path (workspace dev or
 * `node_modules` install).
 *
 * The dispatch logic lives as a top-level argv side-effect in
 * `./lib/auto-dispatch.ts` (so it ALSO fires when consumers import the
 * SDK barrel into a `bun build --compile` binary — that's the entire
 * reason compiled hosts no longer need any boilerplate). This script
 * just imports that side-effect so it runs when bun loads the file.
 */
import "./lib/auto-dispatch.ts";
