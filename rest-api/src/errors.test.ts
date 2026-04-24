import { test, expect, describe } from "bun:test";
import {
  HttpError,
  NotFoundError,
  BadRequestError,
  errorResponse,
  jsonResponse,
} from "./errors";
import type { ErrorResponseBody } from "./errors";

describe("HttpError", () => {
  test("sets status and message", () => {
    const err = new HttpError(418, "I'm a teapot");
    expect(err.status).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err instanceof Error).toBe(true);
  });
});

describe("NotFoundError", () => {
  test("default message and status 404", () => {
    const err = new NotFoundError();
    expect(err.status).toBe(404);
    expect(err.message).toBe("Resource not found");
    expect(err instanceof HttpError).toBe(true);
  });

  test("custom message", () => {
    const err = new NotFoundError("Item missing");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Item missing");
  });
});

describe("BadRequestError", () => {
  test("status 400 and provided message", () => {
    const err = new BadRequestError("bad");
    expect(err.status).toBe(400);
    expect(err.message).toBe("bad");
    expect(err instanceof HttpError).toBe(true);
  });
});

describe("errorResponse", () => {
  test("NotFoundError → 404 with correct JSON body", async () => {
    const res = errorResponse(new NotFoundError());
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error.status).toBe(404);
    expect(body.error.message).toBe("Resource not found");
  });

  test("unknown Error → 500 Internal Server Error", async () => {
    const res = errorResponse(new Error("boom"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error.status).toBe(500);
    expect(body.error.message).toBe("Internal Server Error");
  });

  test("string thrown → 500 Internal Server Error", async () => {
    const res = errorResponse("string thrown");
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error.status).toBe(500);
    expect(body.error.message).toBe("Internal Server Error");
  });

  test("HttpError subclass → uses its status and message", async () => {
    const res = errorResponse(new BadRequestError("bad input"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponseBody;
    expect(body.error.status).toBe(400);
    expect(body.error.message).toBe("bad input");
  });
});

describe("jsonResponse", () => {
  test("status 201, json body, content-type set", async () => {
    const res = jsonResponse({ ok: true }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("default status 200", async () => {
    const res = jsonResponse({ val: 42 });
    expect(res.status).toBe(200);
  });

  test("merges extra init headers", async () => {
    const res = jsonResponse({}, { headers: { "x-custom": "yes" } });
    expect(res.headers.get("x-custom")).toBe("yes");
    expect(res.headers.get("content-type")).toBe("application/json");
  });
});
