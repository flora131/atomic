export const WORKER_PREFLIGHT_CONTRACT = [
  "Before normal implementation delegation, determine whether this checkout appears initialized for its actual language, framework, and build system.",
  "Do not rely on hard-coded assumptions about JavaScript, TypeScript, Python, Rust, Go, Java, mobile, or any other ecosystem. Infer the project type and setup requirements from repository evidence.",
  "Inspect source layout, setup docs, package/build manifests, lockfiles, toolchain files, generated-artifact conventions, CI workflows, workflow configuration, and package scripts or equivalent task definitions.",
  "Look for evidence that dependencies, generated files, local toolchains, submodules, codegen outputs, or other project-specific initialization artifacts are missing for this checkout.",
  "When repository evidence shows missing initialization, run or delegate the appropriate documented setup command before implementation work.",
  "You are responsible for initializing the checkout when setup commands are documented; missing dependencies, generated files, or local toolchains are setup work, not user handoff work.",
  "Once setup succeeds, continue normal implementation orchestration. Do not treat missing dependencies or generated setup artifacts in a fresh worktree as implementation failures.",
  "If setup requirements cannot be determined confidently, delegate a focused discovery task before implementation instead of guessing.",
  "If setup remains blocked after evidence-based discovery and setup attempts, report the blocker with commands tried and the exact evidence needed to continue.",
].join("\n");
