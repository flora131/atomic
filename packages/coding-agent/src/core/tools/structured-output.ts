import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import { defineTool, type ToolDefinition } from "../extensions/types.ts";

export const STRUCTURED_OUTPUT_TOOL_NAME = "structured_output";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

export interface StructuredOutputCapture<TValue> {
	value: TValue | undefined;
	called: boolean;
}

export interface StructuredOutputFileCapture {
	outputPath: string;
	metadataPath?: string;
}

export interface StructuredOutputCaptureMetadata {
	toolName: string;
	toolCallId: string;
	success: true;
	terminate: true;
	capturedAt: string;
}

type StructuredOutputParameterSchema = TSchema & {
	readonly type?: "object" | readonly ["object"];
	readonly properties?: Record<string, TSchema>;
	readonly required?: readonly string[];
	readonly additionalProperties?: boolean | TSchema;
};

export interface StructuredOutputToolOptions<TSchemaDef extends TSchema = typeof genericStructuredOutputParameters> {
	/** Tool parameter schema. Defaults to a generic top-level JSON object. */
	schema?: TSchemaDef;
	/** In-process result sink for SDK and workflow callers. */
	capture?: StructuredOutputCapture<Static<TSchemaDef>>;
	/** Cross-process result sink for subagent child runtimes. */
	output?: StructuredOutputFileCapture;
	/** Tool name. Defaults to `structured_output`. */
	name?: string;
}

const genericStructuredOutputParameters = Type.Object({}, {
	description: "A top-level JSON object containing the final machine-readable answer.",
	additionalProperties: Type.Unknown(),
});

type JsonSchemaRootDescriptor = {
	readonly type?: string | readonly string[];
	readonly anyOf?: readonly TSchema[];
	readonly oneOf?: readonly TSchema[];
	readonly allOf?: readonly TSchema[];
};

function schemaTypeIsObjectOnly(type: JsonSchemaRootDescriptor["type"]): boolean {
	if (type === "object") return true;
	return Array.isArray(type) && type.length === 1 && type[0] === "object";
}

function isTopLevelObjectParameterSchema(schema: TSchema): boolean {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return false;
	const descriptor = schema as JsonSchemaRootDescriptor;
	if (schemaTypeIsObjectOnly(descriptor.type)) return true;
	if (descriptor.type !== undefined) return false;
	if (Array.isArray(descriptor.anyOf) || Array.isArray(descriptor.oneOf)) return false;
	if (Array.isArray(descriptor.allOf)) {
		return descriptor.allOf.length > 0 && descriptor.allOf.every((member) => isTopLevelObjectParameterSchema(member));
	}
	return false;
}

function assertStructuredOutputParameterSchema(
	schema: TSchema,
	label: string,
): asserts schema is StructuredOutputParameterSchema {
	if (isTopLevelObjectParameterSchema(schema)) return;
	throw new Error(
		`${label} must be a top-level object tool-argument schema. `
		+ "Wrap array or primitive outputs in an object field, for example `{ items: [...] }` or `{ value: ... }`.",
	);
}

function formatValidationErrorPath(instancePath: string): string {
	const normalized = instancePath.replace(/^\//, "").replace(/\//g, ".");
	return normalized.length > 0 ? normalized : "root";
}

function formatValidationErrors(schema: TSchema, value: unknown): string {
	const errors = Value.Errors(schema, value)
		.slice(0, 8)
		.map((error) => `${formatValidationErrorPath(error.instancePath)}: ${error.message}`);
	return errors.join("; ") || "schema validation failed";
}

function assertValidParams<TSchemaDef extends TSchema>(schema: TSchemaDef, params: Static<TSchemaDef>): void {
	if (Value.Check(schema, params)) {
		return;
	}
	throw new Error(`Structured output validation failed: ${formatValidationErrors(schema, params)}`);
}

function stringifyParams<TSchemaDef extends TSchema>(params: Static<TSchemaDef>): string {
	try {
		return JSON.stringify(params, null, 2);
	} catch (error) {
		throw new Error(`Structured output must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function getStructuredOutputMetadataPath(outputPath: string): string {
	const directory = path.dirname(outputPath);
	const basename = path.basename(outputPath);
	if (basename === "output.json") {
		return path.join(directory, "output.meta.json");
	}
	if (path.extname(basename) === ".json") {
		return path.join(directory, `${basename.slice(0, -".json".length)}.meta.json`);
	}
	return `${outputPath}.meta.json`;
}

function createStructuredOutputCaptureMetadata(toolName: string, toolCallId: string): StructuredOutputCaptureMetadata {
	return {
		toolName,
		toolCallId,
		success: true,
		terminate: true,
		capturedAt: new Date().toISOString(),
	};
}

async function writePrivateJsonFile(filePath: string, serializedJson: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, serializedJson, { mode: 0o600 });
	// Re-apply the private mode after writing so pre-existing looser files are tightened too.
	await fs.chmod(filePath, 0o600);
}

async function writeCapturedOutput(
	output: StructuredOutputFileCapture,
	serializedParams: string,
	metadata: StructuredOutputCaptureMetadata,
): Promise<void> {
	try {
		await writePrivateJsonFile(output.outputPath, serializedParams);
		await writePrivateJsonFile(output.metadataPath ?? getStructuredOutputMetadataPath(output.outputPath), stringifyParams(metadata));
	} catch (error) {
		throw new Error(`Failed to write structured output capture: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function createStructuredOutputCapture<TValue>(): StructuredOutputCapture<TValue> {
	return { value: undefined, called: false };
}

export function createStructuredOutputTool<TSchemaDef extends TSchema = typeof genericStructuredOutputParameters>(
	options: StructuredOutputToolOptions<TSchemaDef> = {},
): ToolDefinition<TSchemaDef, Static<TSchemaDef>> {
	const name = options.name ?? STRUCTURED_OUTPUT_TOOL_NAME;
	const schema = (options.schema === undefined ? genericStructuredOutputParameters : options.schema) as TSchemaDef;
	assertStructuredOutputParameterSchema(schema, `${name} schema`);

	let outputCalled = false;
	const hasSingleRunSink = options.capture !== undefined || options.output !== undefined;

	return defineTool({
		name,
		label: "Structured Output",
		description: "Submit the final machine-readable structured output. This terminates the current agent turn.",
		promptSnippet: `Submit the final machine-readable answer as a terminating ${name} tool call`,
		promptGuidelines: [
			`Use ${name} exactly once as your final action when the requested result should be machine-readable or schema-valid.`,
			"Pass the schema fields directly as tool arguments; do not wrap them in `{ value: ... }` unless the schema explicitly defines a top-level `value` field.",
			`Do not write prose after calling ${name}; the tool result is the final answer.`,
		],
		parameters: schema,
		maxResultSizeChars: Infinity,
		structuredOutput: true,
		executionMode: "sequential",
		async execute(toolCallId, params): Promise<AgentToolResult<Static<TSchemaDef>>> {
			assertValidParams(schema, params);
			if (hasSingleRunSink && (outputCalled || options.capture?.called)) {
				throw new Error(`${name} was already called for this result contract.`);
			}

			const serializedParams = stringifyParams(params);
			if (options.output) {
				await writeCapturedOutput(options.output, serializedParams, createStructuredOutputCaptureMetadata(name, toolCallId));
			}
			if (options.capture) {
				options.capture.value = params;
				options.capture.called = true;
			}
			outputCalled = true;

			return {
				content: [{ type: "text", text: serializedParams }],
				details: params,
				terminate: true,
			};
		},
	});
}
