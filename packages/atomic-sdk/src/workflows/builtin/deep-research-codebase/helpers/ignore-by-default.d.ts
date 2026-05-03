// `ignore-by-default` ships no .d.ts and `@types/ignore-by-default` is an
// empty placeholder package. Declare the surface we use here so the import
// in scout.ts type-checks. The runtime API is a single CJS export:
// `module.exports.directories(): string[]`.
declare module "ignore-by-default" {
  const ibd: { directories(): string[] };
  export default ibd;
}
