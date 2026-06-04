export const bundledPiTuiRootPackageName = "@earendil-works/pi-tui";
export const bundledPiTuiExpectedRuntimePackages = [
	bundledPiTuiRootPackageName,
	"get-east-asian-width",
	"marked",
] as const;
// Sentinel string lifted from the TEMPORARY #1222 renderer patch: its presence in dist/tui.js is how
// we prove the patched pi-tui (not a stock copy) got bundled. Delete this once an upstream pi-tui
// release ships the fix and the bundling mechanism is removed.
export const bundledPiTuiPatchedRendererMarker = "Strict off-viewport same-count changes are state-only";

export function bundledPackageJsonTarPath(packageName: string): string {
	return `package/node_modules/${packageName}/package.json`;
}

export function bundledPackageTarPath(packageName: string, relativePackagePath: string): string {
	return `package/node_modules/${packageName}/${relativePackagePath}`;
}
