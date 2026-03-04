import type { InstallationType } from "./config-path.ts";
import { detectInstallationType } from "./config-path.ts";
import type {
  DiscoveryProvider,
  ProviderDiscoveryCompatibility,
  ProviderDiscoveryTier,
} from "./provider-discovery-contract.ts";
import { homedir } from "node:os";
import { relative, resolve, sep } from "node:path";

export type DiscoveryEventName =
  | "discovery.plan.generated"
  | "discovery.compatibility.filtered"
  | "discovery.definition.skipped"
  | "discovery.runtime.startup_error"
  | "discovery.path.conflict";

export type DiscoveryEventLevel = "debug" | "warn" | "error";

export type DiscoveryEventDataValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[];

export interface DiscoveryEventData {
  readonly [key: string]: DiscoveryEventDataValue;
}

export interface DiscoveryEventTags {
  provider: DiscoveryProvider;
  installType: InstallationType;
  path: string;
  rootId?: string;
  rootTier?: ProviderDiscoveryTier;
  rootCompatibility?: ProviderDiscoveryCompatibility;
}

export interface DiscoveryEventPayload {
  schema: "atomic.discovery.event.v1";
  event: DiscoveryEventName;
  tags: DiscoveryEventTags;
  data?: DiscoveryEventData;
}

export interface DiscoveryEventLogger {
  debug: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface EmitDiscoveryEventOptions {
  level?: DiscoveryEventLevel;
  tags: Omit<DiscoveryEventTags, "installType"> & {
    installType?: InstallationType;
  };
  data?: DiscoveryEventData;
  logger?: DiscoveryEventLogger;
}

const DISCOVERY_EVENT_PREFIX = "[discovery.event]";

interface DiscoveryEventRedactionContext {
  projectRoot: string;
  homeDir: string;
}

const POSIX_INLINE_PATH_PATTERN = /(^|[\s"'`(])((?:~\/|\/)[^\s"'`,;:()<>]+)/g;
const WINDOWS_INLINE_PATH_PATTERN =
  /(^|[\s"'`(])([A-Za-z]:\\[^\s"'`,;:()<>]+)/g;

function getDefaultDiscoveryEventLogger(): DiscoveryEventLogger {
  return {
    debug: (message) => console.debug(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
  };
}

function isTruthyDebugValue(debugValue: string | undefined): boolean {
  if (!debugValue) {
    return false;
  }

  const normalizedValue = debugValue.trim().toLowerCase();
  if (normalizedValue.length === 0) {
    return false;
  }

  return !["0", "false", "off", "no"].includes(normalizedValue);
}

export function isDiscoveryDebugLoggingEnabled(): boolean {
  return isTruthyDebugValue(process.env.DEBUG);
}

function createDiscoveryEventRedactionContext(): DiscoveryEventRedactionContext {
  return {
    projectRoot: resolve(process.cwd()),
    homeDir: resolve(homedir()),
  };
}

function isSameOrDescendantPath(pathValue: string, basePath: string): boolean {
  const resolvedPath = resolve(pathValue);
  const resolvedBasePath = resolve(basePath);
  return (
    resolvedPath === resolvedBasePath ||
    resolvedPath.startsWith(`${resolvedBasePath}${sep}`)
  );
}

function normalizeRelativePathForTelemetry(relativePath: string): string {
  return relativePath.split(sep).join("/");
}

function resolvePathCandidateForRedaction(
  pathValue: string,
  context: DiscoveryEventRedactionContext,
): string {
  const trimmedValue = pathValue.trim();
  if (trimmedValue === "~") {
    return context.homeDir;
  }

  if (trimmedValue.startsWith("~/")) {
    return resolve(context.homeDir, trimmedValue.slice(2));
  }

  return resolve(trimmedValue);
}

function redactPathForTelemetry(
  pathValue: string,
  context: DiscoveryEventRedactionContext,
): string {
  const resolvedPath = resolvePathCandidateForRedaction(pathValue, context);

  if (isSameOrDescendantPath(resolvedPath, context.projectRoot)) {
    const projectRelativePath = relative(context.projectRoot, resolvedPath);
    return projectRelativePath.length > 0
      ? `<project>/${normalizeRelativePathForTelemetry(projectRelativePath)}`
      : "<project>";
  }

  if (isSameOrDescendantPath(resolvedPath, context.homeDir)) {
    const homeRelativePath = relative(context.homeDir, resolvedPath);
    return homeRelativePath.length > 0
      ? `~/${normalizeRelativePathForTelemetry(homeRelativePath)}`
      : "~";
  }

  return "<external-path>";
}

function isLikelyFilesystemPath(value: string): boolean {
  return (
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\\/.test(value)
  );
}

function redactInlinePaths(
  value: string,
  context: DiscoveryEventRedactionContext,
): string {
  const replaceMatch = (
    _fullMatch: string,
    prefix: string,
    matchedPath: string,
  ): string => `${prefix}${redactPathForTelemetry(matchedPath, context)}`;

  return value
    .replace(POSIX_INLINE_PATH_PATTERN, replaceMatch)
    .replace(WINDOWS_INLINE_PATH_PATTERN, replaceMatch);
}

function redactSensitiveStringValue(
  value: string,
  context: DiscoveryEventRedactionContext,
): string {
  if (
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("~")
  ) {
    return value;
  }

  if (isLikelyFilesystemPath(value)) {
    return redactPathForTelemetry(value, context);
  }

  return redactInlinePaths(value, context);
}

function redactDiscoveryEventDataValue(
  value: DiscoveryEventDataValue,
  context: DiscoveryEventRedactionContext,
): DiscoveryEventDataValue {
  if (typeof value === "string") {
    return redactSensitiveStringValue(value, context);
  }

  if (
    Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === "string")
  ) {
    return value.map((entry) => redactSensitiveStringValue(entry, context));
  }

  return value;
}

function redactDiscoveryEventData(
  data: DiscoveryEventData,
  context: DiscoveryEventRedactionContext,
): DiscoveryEventData {
  const redactedData: Record<string, DiscoveryEventDataValue> = {};

  for (const [key, value] of Object.entries(data)) {
    redactedData[key] = redactDiscoveryEventDataValue(value, context);
  }

  return redactedData;
}

export function resolveDiscoveryInstallType(
  installType?: InstallationType,
): InstallationType {
  if (installType) {
    return installType;
  }

  try {
    return detectInstallationType();
  } catch {
    return "source";
  }
}

export function buildDiscoveryEventPayload(
  event: DiscoveryEventName,
  options: EmitDiscoveryEventOptions,
): DiscoveryEventPayload {
  const { tags, data } = options;
  const redactionContext = createDiscoveryEventRedactionContext();
  return {
    schema: "atomic.discovery.event.v1",
    event,
    tags: {
      ...tags,
      installType: resolveDiscoveryInstallType(tags.installType),
      path: redactPathForTelemetry(tags.path, redactionContext),
    },
    ...(data
      ? {
        data: redactDiscoveryEventData(data, redactionContext),
      }
      : {}),
  };
}

export function emitDiscoveryEvent(
  event: DiscoveryEventName,
  options: EmitDiscoveryEventOptions,
): void {
  const payload = buildDiscoveryEventPayload(event, options);
  const serializedPayload = `${DISCOVERY_EVENT_PREFIX} ${JSON.stringify(payload)}`;
  const logger = options.logger ?? getDefaultDiscoveryEventLogger();
  const level = options.level ?? "debug";
  const debugLoggingEnabled = isDiscoveryDebugLoggingEnabled();

  if (level !== "error" && !debugLoggingEnabled) {
    return;
  }

  if (level === "warn") {
    logger.warn(serializedPayload);
    return;
  }

  if (level === "error") {
    logger.error(serializedPayload);
    return;
  }

  logger.debug(serializedPayload);
}
