export const GIT_LOCAL_ENV_VARS = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_OBJECT_DIRECTORY",
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE",
	"GIT_INDEX_FILE",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_REPLACE_REF_BASE",
	"GIT_PREFIX",
	"GIT_SHALLOW_FILE",
	"GIT_COMMON_DIR",
] as const;

/**
 * Create an environment for Git subprocesses that target an explicit cwd/path.
 *
 * Git honors repository-local environment variables over cwd and `git -C`, so
 * inherited values from hooks or unrelated worktrees can make a subprocess
 * inspect the wrong repository. This list mirrors `git rev-parse --local-env-vars`.
 */
export function createGitEnvironment(
	overrides?: NodeJS.ProcessEnv,
	baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...baseEnv };
	if (overrides) Object.assign(env, overrides);
	for (const key of GIT_LOCAL_ENV_VARS) delete env[key];
	return env;
}
