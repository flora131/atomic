export type Item = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
};

export type CreateItemInput = {
  name: string;
  description?: string | null;
};

export type UpdateItemInput = {
  name?: string;
  description?: string | null;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_CREATE_FIELDS = new Set(["name", "description"]);
const ALLOWED_UPDATE_FIELDS = new Set(["name", "description"]);

function checkUnknownFields(obj: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`Invalid request body: unknown field ${key}`);
    }
  }
}

function validateName(value: unknown, required: true): string;
function validateName(value: unknown, required: false): string | undefined;
function validateName(value: unknown, required: boolean): string | undefined {
  if (value === undefined) {
    if (required) {
      throw new Error("Invalid request body: name is required");
    }
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Invalid request body: name must be a non-empty string");
  }
  if (value.trim().length > 200) {
    throw new Error("Invalid request body: name must not exceed 200 characters");
  }
  return value.trim();
}

function validateDescription(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("Invalid request body: description must be a string or null");
  }
  if (value.length > 2000) {
    throw new Error("Invalid request body: description must not exceed 2000 characters");
  }
  return value;
}

// ---------------------------------------------------------------------------
// Parse functions (throw on invalid input)
// ---------------------------------------------------------------------------

export function parseCreateItemInput(value: unknown): CreateItemInput {
  if (!isPlainObject(value)) {
    throw new Error("Invalid request body: body must be an object");
  }
  checkUnknownFields(value, ALLOWED_CREATE_FIELDS);
  const name = validateName(value["name"], true);
  const description = validateDescription(value["description"]);
  const result: CreateItemInput = { name };
  if (description !== undefined) {
    result.description = description;
  }
  return result;
}

export function parseUpdateItemInput(value: unknown): UpdateItemInput {
  if (!isPlainObject(value)) {
    throw new Error("Invalid request body: body must be an object");
  }
  checkUnknownFields(value, ALLOWED_UPDATE_FIELDS);
  const name = validateName(value["name"], false);
  const description = validateDescription(value["description"]);
  const result: UpdateItemInput = {};
  if (name !== undefined) {
    result.name = name;
  }
  if (description !== undefined) {
    result.description = description;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Legacy result-style validators (kept for backward compatibility)
// ---------------------------------------------------------------------------

type ValidResult<T> = { ok: true; value: T };
type InvalidResult = { ok: false; error: string };
type ValidationResult<T> = ValidResult<T> | InvalidResult;

export function validateCreateItemInput(body: unknown): ValidationResult<CreateItemInput> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body must be an object" };
  }

  const rawName = body["name"];
  const rawDescription = body["description"];

  if (typeof rawName !== "string" || rawName.trim() === "") {
    return { ok: false, error: "name must be a non-empty string" };
  }

  if (rawDescription !== undefined && typeof rawDescription !== "string") {
    return { ok: false, error: "description must be a string" };
  }

  const result: CreateItemInput = { name: rawName.trim() };
  if (rawDescription !== undefined && typeof rawDescription === "string") {
    result.description = rawDescription;
  }

  return { ok: true, value: result };
}

export function validateUpdateItemInput(body: unknown): ValidationResult<UpdateItemInput> {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body must be an object" };
  }

  const rawName = body["name"];
  const rawDescription = body["description"];

  if (rawName !== undefined) {
    if (typeof rawName !== "string" || rawName.trim() === "") {
      return { ok: false, error: "name must be a non-empty string" };
    }
  }

  if (rawDescription !== undefined && rawDescription !== null) {
    if (typeof rawDescription !== "string") {
      return { ok: false, error: "description must be a string" };
    }
  }

  if (rawName === undefined && rawDescription === undefined) {
    return { ok: false, error: "at least one of name or description must be provided" };
  }

  const result: UpdateItemInput = {};
  if (rawName !== undefined && typeof rawName === "string") {
    result.name = rawName.trim();
  }
  if (rawDescription !== undefined) {
    result.description = rawDescription as string | null;
  }

  return { ok: true, value: result };
}
