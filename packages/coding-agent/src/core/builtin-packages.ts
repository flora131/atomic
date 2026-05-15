import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir } from "../config.js";

interface BuiltinPackageDescriptor {
	readonly packageName: string;
	readonly distDirName: string;
	readonly requiredEntry: string;
	readonly sourceCandidates: (context: BuiltinPackageCandidateContext) => string[];
}

interface BuiltinPackageCandidateContext {
	readonly here: string;
	readonly packageDir: string;
	readonly isSourceCheckout: boolean;
}

interface WorkspaceBuiltinSpec {
	readonly packageName: string;
	readonly workspaceDirName: string;
	readonly distDirName: string;
	readonly requiredEntry: string;
}

const BUILTIN_EXTENSION_FILES = ["btw.ts", "goal.ts", "review.ts", "todos.ts", "whimsical.ts"] as const;

const WORKSPACE_BUILTINS: readonly WorkspaceBuiltinSpec[] = [
	{
		packageName: "@bastani/workflows",
		workspaceDirName: "workflows",
		distDirName: "workflows",
		requiredEntry: join("src", "extension", "index.ts"),
	},
	{
		packageName: "@bastani/subagents",
		workspaceDirName: "subagents",
		distDirName: "subagents",
		requiredEntry: join("src", "extension", "index.ts"),
	},
	{
		packageName: "@bastani/mcp",
		workspaceDirName: "mcp",
		distDirName: "mcp",
		requiredEntry: "index.ts",
	},
	{
		packageName: "@bastani/web-access",
		workspaceDirName: "web-access",
		distDirName: "web-access",
		requiredEntry: "index.ts",
	},
	{
		packageName: "@bastani/intercom",
		workspaceDirName: "intercom",
		distDirName: "intercom",
		requiredEntry: "index.ts",
	},
];

const BUILTIN_PACKAGES: readonly BuiltinPackageDescriptor[] = WORKSPACE_BUILTINS.map(
	(spec): BuiltinPackageDescriptor => ({
		packageName: spec.packageName,
		distDirName: spec.distDirName,
		requiredEntry: spec.requiredEntry,
		sourceCandidates: ({ here, packageDir, isSourceCheckout }) =>
			isSourceCheckout
				? [
						join(packageDir, "..", spec.workspaceDirName),
						join(here, "..", "..", "..", spec.workspaceDirName),
					]
				: [],
	}),
);

function readPackageName(packageJsonPath: string): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: string };
		return pkg.name;
	} catch {
		return undefined;
	}
}

function isPackageDir(dir: string, descriptor: BuiltinPackageDescriptor): boolean {
	return (
		existsSync(join(dir, descriptor.requiredEntry)) &&
		readPackageName(join(dir, "package.json")) === descriptor.packageName
	);
}

function firstExistingPackageDir(candidates: string[], descriptor: BuiltinPackageDescriptor): string | undefined {
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const resolved = resolve(candidate);
		if (seen.has(resolved)) {
			continue;
		}
		seen.add(resolved);
		if (isPackageDir(resolved, descriptor)) {
			return resolved;
		}
	}

	return undefined;
}

function firstExistingBuiltinExtensionDir(candidates: string[]): string | undefined {
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const resolved = resolve(candidate);
		if (seen.has(resolved)) {
			continue;
		}
		seen.add(resolved);
		if (BUILTIN_EXTENSION_FILES.every((file) => existsSync(join(resolved, file)))) {
			return resolved;
		}
	}

	return undefined;
}

function distCandidates(context: BuiltinPackageCandidateContext, descriptor: BuiltinPackageDescriptor): string[] {
	const { here, packageDir } = context;
	return [
		join(here, "..", "builtin", descriptor.distDirName),
		join(packageDir, "builtin", descriptor.distDirName),
		join(packageDir, "dist", "builtin", descriptor.distDirName),
	];
}

function builtinExtensionDirCandidates(context: BuiltinPackageCandidateContext): string[] {
	const { here, packageDir } = context;
	return [
		join(here, "..", "builtin", "extensions"),
		join(packageDir, "builtin", "extensions"),
		join(packageDir, "dist", "builtin", "extensions"),
	];
}

function getBuiltinPackageCandidateContext(): BuiltinPackageCandidateContext {
	const context: BuiltinPackageCandidateContext = {
		here: dirname(fileURLToPath(import.meta.url)),
		packageDir: getPackageDir(),
		isSourceCheckout: false,
	};
	return {
		...context,
		isSourceCheckout: existsSync(join(context.packageDir, "src", "main.ts")),
	};
}

/**
 * Built-in extension files shipped directly with this Atomic distribution.
 *
 * Development layout:
 *   packages/coding-agent/src/core -> packages/coding-agent/builtin/extensions
 *
 * npm/dist layout:
 *   packages/coding-agent/dist/core -> packages/coding-agent/dist/builtin/extensions
 *
 * Bun binary layout:
 *   process executable dir -> builtin/extensions
 */
export function getBuiltinExtensionPaths(): string[] {
	const context = getBuiltinPackageCandidateContext();
	const extensionDir = firstExistingBuiltinExtensionDir(builtinExtensionDirCandidates(context));
	return extensionDir ? BUILTIN_EXTENSION_FILES.map((file) => join(extensionDir, file)) : [];
}

/**
 * Built-in pi package roots shipped with this Atomic distribution.
 *
 * Development layout:
 *   packages/coding-agent/src/core -> packages/<builtin>
 *
 * npm/dist layout:
 *   packages/coding-agent/dist/core -> packages/coding-agent/dist/builtin/<package>
 *
 * Bun binary layout:
 *   process executable dir -> builtin/<package>
 */
export function getBuiltinPackagePaths(): string[] {
	const context = getBuiltinPackageCandidateContext();

	return BUILTIN_PACKAGES.flatMap((descriptor) => {
		const packageDir = firstExistingPackageDir(
			[...descriptor.sourceCandidates(context), ...distCandidates(context, descriptor)],
			descriptor,
		);
		return packageDir ? [packageDir] : [];
	});
}
