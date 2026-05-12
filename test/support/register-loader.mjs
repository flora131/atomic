/**
 * Register the .js → .ts loader hook for integration tests.
 *
 * Usage: node --experimental-transform-types --import ./test/support/register-loader.mjs --test test/integration/*.test.ts
 *
 * Source files use .js import extensions (TypeScript ESM convention) but
 * files on disk are .ts — the loader rewrites .js → .ts at resolve time.
 * Some files also use TypeScript parameter properties which require
 * --experimental-transform-types (not just --experimental-strip-types).
 */

import { register } from "node:module";

register(new URL("./ts-loader.mjs", import.meta.url));
