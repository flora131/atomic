import {
  test,
  expect,
  describe,
  beforeEach,
  afterEach,
} from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureGlobalAtomicSettings,
  setTelemetryEnabled,
  setScmProvider,
} from "../../../packages/atomic/src/services/config/settings.ts";
import { SETTINGS_SCHEMA_URL } from "../../../packages/atomic-sdk/src/services/config/settings-schema.ts";

let tmpDir: string;
let previousSettingsHome: string | undefined;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "settings-test-"));
  previousSettingsHome = process.env.ATOMIC_SETTINGS_HOME;
  process.env.ATOMIC_SETTINGS_HOME = tmpDir;
});

afterEach(async () => {
  if (previousSettingsHome === undefined) {
    delete process.env.ATOMIC_SETTINGS_HOME;
  } else {
    process.env.ATOMIC_SETTINGS_HOME = previousSettingsHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

function settingsPath(): string {
  return join(tmpDir, ".atomic", "settings.json");
}

async function writeGlobalSettings(value: Record<string, unknown>): Promise<void> {
  const dir = join(tmpDir, ".atomic");
  await mkdir(dir, { recursive: true });
  await writeFile(settingsPath(), JSON.stringify(value));
}

async function readGlobalSettings(): Promise<Record<string, unknown>> {
  const raw = await readFile(settingsPath(), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("ensureGlobalAtomicSettings", () => {
  test("creates settings.json with $schema and version when missing", async () => {
    await ensureGlobalAtomicSettings();

    const settings = await readGlobalSettings();
    expect(settings.$schema).toBe(SETTINGS_SCHEMA_URL);
    expect(settings.version).toBe(1);
  });

  test("is a no-op when settings.json already exists", async () => {
    await writeGlobalSettings({ version: 99, telemetryEnabled: true });
    const before = await readFile(settingsPath(), "utf8");

    await ensureGlobalAtomicSettings();

    const after = await readFile(settingsPath(), "utf8");
    expect(after).toBe(before);
  });

  test("swallows filesystem errors instead of throwing", async () => {
    // Point at a path that cannot be created (parent is a regular file).
    const blockingFile = join(tmpDir, "blocker");
    await writeFile(blockingFile, "not a directory");
    process.env.ATOMIC_SETTINGS_HOME = blockingFile;

    expect(await ensureGlobalAtomicSettings()).toBeUndefined();
  });
});

describe("setTelemetryEnabled", () => {
  test("writes telemetryEnabled: true into a fresh settings file", async () => {
    await setTelemetryEnabled(true);

    const settings = await readGlobalSettings();
    expect(settings.telemetryEnabled).toBe(true);
    expect(settings.$schema).toBe(SETTINGS_SCHEMA_URL);
  });

  test("writes telemetryEnabled: false", async () => {
    await setTelemetryEnabled(false);

    const settings = await readGlobalSettings();
    expect(settings.telemetryEnabled).toBe(false);
  });

  test("preserves unrelated existing fields", async () => {
    await writeGlobalSettings({
      version: 1,
      scm: "github",
      providers: { claude: { envVars: { COLORTERM: "truecolor" } } },
    });

    await setTelemetryEnabled(true);

    const settings = await readGlobalSettings();
    expect(settings.telemetryEnabled).toBe(true);
    expect(settings.scm).toBe("github");
    expect((settings.providers as Record<string, { envVars?: Record<string, string> }>).claude?.envVars?.COLORTERM).toBe("truecolor");
  });

  test("swallows filesystem errors instead of throwing", async () => {
    const blockingFile = join(tmpDir, "blocker");
    await writeFile(blockingFile, "not a directory");
    process.env.ATOMIC_SETTINGS_HOME = blockingFile;

    expect(await setTelemetryEnabled(true)).toBeUndefined();
  });
});

describe("setScmProvider", () => {
  test("writes scm: 'github' into a fresh settings file", async () => {
    await setScmProvider("github");

    const settings = await readGlobalSettings();
    expect(settings.scm).toBe("github");
    expect(settings.$schema).toBe(SETTINGS_SCHEMA_URL);
  });

  test("overwrites a previously selected provider", async () => {
    await writeGlobalSettings({ version: 1, scm: "github" });

    await setScmProvider("azure-devops");

    const settings = await readGlobalSettings();
    expect(settings.scm).toBe("azure-devops");
  });

  test("preserves unrelated existing fields", async () => {
    await writeGlobalSettings({
      version: 1,
      telemetryEnabled: false,
      providers: { copilot: { chatFlags: ["--print"] } },
    });

    await setScmProvider("sapling");

    const settings = await readGlobalSettings();
    expect(settings.scm).toBe("sapling");
    expect(settings.telemetryEnabled).toBe(false);
    expect((settings.providers as Record<string, { chatFlags?: string[] }>).copilot?.chatFlags).toEqual(["--print"]);
  });

  test("swallows filesystem errors instead of throwing", async () => {
    const blockingFile = join(tmpDir, "blocker");
    await writeFile(blockingFile, "not a directory");
    process.env.ATOMIC_SETTINGS_HOME = blockingFile;

    expect(await setScmProvider("github")).toBeUndefined();
  });
});
