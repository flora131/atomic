// ESM loader hook: rewrite .js imports to .ts when the .js file doesn't exist
// but a .ts file does. This bridges the gap between source-level .js extension
// imports and the actual .ts files on disk.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export function resolve(specifier, context, nextResolve) {
	if (!specifier.startsWith(".") || !specifier.endsWith(".js")) {
		return nextResolve(specifier, context);
	}

	const parentDir = context.parentURL
		? path.dirname(fileURLToPath(context.parentURL))
		: process.cwd();
	const jsPath = path.resolve(parentDir, specifier);
	const tsPath = jsPath.replace(/\.js$/, ".ts");

	if (!fs.existsSync(jsPath) && fs.existsSync(tsPath)) {
		return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
	}

	return nextResolve(specifier, context);
}
