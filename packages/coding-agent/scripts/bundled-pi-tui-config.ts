export const bundledPiTuiRootPackageName = "@earendil-works/pi-tui";
export const bundledPiTuiExpectedRuntimePackages = [
	bundledPiTuiRootPackageName,
	"get-east-asian-width",
	"marked",
] as const;
export const bundledPiTuiPatchedRendererMarker = "Same-shape text changes above the previous viewport";

export function bundledPackageJsonTarPath(packageName: string): string {
	return `package/node_modules/${packageName}/package.json`;
}

export function bundledPackageTarPath(packageName: string, relativePackagePath: string): string {
	return `package/node_modules/${packageName}/${relativePackagePath}`;
}
