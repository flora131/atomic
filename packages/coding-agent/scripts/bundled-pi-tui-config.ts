export const bundledPiTuiRootPackageName = "@earendil-works/pi-tui";
export const bundledPiTuiExpectedRuntimePackages = [
	bundledPiTuiRootPackageName,
	"get-east-asian-width",
	"marked",
] as const;
export const bundledPiTuiPatchedRendererMarker = "Strict off-viewport same-count changes are state-only";

export function bundledPackageJsonTarPath(packageName: string): string {
	return `package/node_modules/${packageName}/package.json`;
}

export function bundledPackageTarPath(packageName: string, relativePackagePath: string): string {
	return `package/node_modules/${packageName}/${relativePackagePath}`;
}
