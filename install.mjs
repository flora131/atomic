#!/usr/bin/env node

/**
 * @bastani/atomic-workflows installer
 *
 * Usage:
 *   npx atomic-workflows          # Install to ~/.omp/agent/extensions/workflows
 *   npx atomic-workflows --remove # Remove the extension
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const EXTENSION_DIR = path.join(os.homedir(), ".omp", "agent", "extensions", "workflows");
const REPO_URL = "https://github.com/alilavaee/atomic-pi-rewrite.git";

const args = process.argv.slice(2);
const isRemove = args.includes("--remove") || args.includes("-r");
const isHelp = args.includes("--help") || args.includes("-h");

if (isHelp) {
	console.log(`
atomic-workflows - oh-my-pi extension for multi-stage workflow authoring and execution

Usage:
  npx atomic-workflows          Install the extension
  npx atomic-workflows --remove Remove the extension
  npx atomic-workflows --help   Show this help

Installation directory: ${EXTENSION_DIR}
`);
	process.exit(0);
}

if (isRemove) {
	if (fs.existsSync(EXTENSION_DIR)) {
		console.log(`Removing ${EXTENSION_DIR}...`);
		fs.rmSync(EXTENSION_DIR, { recursive: true });
		console.log("atomic-workflows removed");
	} else {
		console.log("atomic-workflows is not installed");
	}
	process.exit(0);
}

console.log("Installing atomic-workflows...\n");

const parentDir = path.dirname(EXTENSION_DIR);
if (!fs.existsSync(parentDir)) {
	fs.mkdirSync(parentDir, { recursive: true });
}

if (fs.existsSync(EXTENSION_DIR)) {
	const isGitRepo = fs.existsSync(path.join(EXTENSION_DIR, ".git"));
	if (isGitRepo) {
		console.log("Updating existing installation...");
		try {
			execSync("git pull", { cwd: EXTENSION_DIR, stdio: "inherit" });
			console.log("\natomic-workflows updated");
		} catch {
			console.error("Failed to update. Try removing and reinstalling:");
			console.error("  npx atomic-workflows --remove && npx atomic-workflows");
			process.exit(1);
		}
	} else {
		console.log(`Directory exists but is not a git repo: ${EXTENSION_DIR}`);
		console.log("Remove it first with: npx atomic-workflows --remove");
		process.exit(1);
	}
} else {
	console.log(`Cloning to ${EXTENSION_DIR}...`);
	try {
		execSync(`git clone ${REPO_URL} "${EXTENSION_DIR}"`, { stdio: "inherit" });
		console.log("\natomic-workflows installed");
	} catch {
		console.error("Failed to clone repository");
		process.exit(1);
	}
}

console.log(`
The extension is now available in oh-my-pi. Tools added:
  • workflow - Author and execute multi-stage workflows

Documentation: ${EXTENSION_DIR}/README.md
`);
