import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "./server";
import { ItemStore } from "./store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function url(server: ReturnType<typeof createServer>, path: string): string {
  return `http://localhost:${server.port}${path}`;
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

// ---------------------------------------------------------------------------
// GET /items
// ---------------------------------------------------------------------------

describe("GET /items", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer({ port: 0, store: new ItemStore() });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("empty store returns [] with status 200", async () => {
    const res = await fetch(url(server, "/items"));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual([]);
  });

  test("after POST contains created item", async () => {
    await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "list-item" }),
    });
    const res = await fetch(url(server, "/items"));
    expect(res.status).toBe(200);
    const items = (await json(res)) as { name: string }[];
    expect(items.length).toBe(1);
    expect(items[0].name).toBe("list-item");
  });
});

// ---------------------------------------------------------------------------
// POST /items
// ---------------------------------------------------------------------------

describe("POST /items", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer({ port: 0, store: new ItemStore() });
  });

  afterAll(() => {
    server.stop(true);
  });

  test("valid body {name:'alpha'} returns 201 with full item shape", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "alpha" }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as Record<string, unknown>;
    expect(typeof body.id).toBe("string");
    expect(body.name).toBe("alpha");
    expect(body.description).toBeNull();
    expect(typeof body.createdAt).toBe("string");
    expect(typeof body.updatedAt).toBe("string");
  });

  test("valid body with description preserves description", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "beta", description: "desc" }),
    });
    expect(res.status).toBe(201);
    const body = (await json(res)) as Record<string, unknown>;
    expect(body.name).toBe("beta");
    expect(body.description).toBe("desc");
  });

  test("missing name returns 400 with error.message containing 'name'", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "no name" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(400);
    expect(body.error.message.toLowerCase()).toContain("name");
  });

  test("empty name returns 400", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(400);
  });

  test("unknown field returns 400", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x", unknown: "field" }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(400);
  });

  test("malformed JSON returns 400 with message 'Invalid JSON body'", async () => {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.message).toBe("Invalid JSON body");
  });
});

// ---------------------------------------------------------------------------
// GET /items/:id
// ---------------------------------------------------------------------------

describe("GET /items/:id", () => {
  let server: ReturnType<typeof createServer>;
  let createdId: string;

  beforeAll(async () => {
    server = createServer({ port: 0, store: new ItemStore() });
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "get-by-id" }),
    });
    const body = (await res.json()) as { id: string };
    createdId = body.id;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("existing id returns item with status 200", async () => {
    const res = await fetch(url(server, `/items/${createdId}`));
    expect(res.status).toBe(200);
    const body = (await json(res)) as Record<string, unknown>;
    expect(body.id).toBe(createdId);
    expect(body.name).toBe("get-by-id");
  });

  test("missing id returns 404 with error shape", async () => {
    const res = await fetch(url(server, "/items/nonexistent-id-xyz"));
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(404);
    expect(typeof body.error.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// PUT /items/:id
// ---------------------------------------------------------------------------

describe("PUT /items/:id", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer({ port: 0, store: new ItemStore() });
  });

  afterAll(() => {
    server.stop(true);
  });

  async function createItem(name: string, description?: string): Promise<Record<string, unknown>> {
    const body: Record<string, string> = { name };
    if (description !== undefined) body.description = description;
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  test("update name returns 200, name changed, updatedAt changed, createdAt and id unchanged", async () => {
    const created = await createItem("original");
    // Small delay to ensure updatedAt differs
    await new Promise((r) => setTimeout(r, 10));
    const res = await fetch(url(server, `/items/${created.id}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "updated" }),
    });
    expect(res.status).toBe(200);
    const updated = (await json(res)) as Record<string, unknown>;
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("updated");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test("update description to null returns 200 with description === null", async () => {
    const created = await createItem("nulldesc", "some desc");
    const res = await fetch(url(server, `/items/${created.id}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: null }),
    });
    expect(res.status).toBe(200);
    const updated = (await json(res)) as Record<string, unknown>;
    expect(updated.description).toBeNull();
  });

  test("missing id returns 404", async () => {
    const res = await fetch(url(server, "/items/nonexistent-put-id"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "whatever" }),
    });
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(404);
  });

  test("invalid body (name: 123) returns 400", async () => {
    const created = await createItem("validitem");
    const res = await fetch(url(server, `/items/${created.id}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /items/:id
// ---------------------------------------------------------------------------

describe("DELETE /items/:id", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer({ port: 0, store: new ItemStore() });
  });

  afterAll(() => {
    server.stop(true);
  });

  async function createItem(name: string): Promise<Record<string, unknown>> {
    const res = await fetch(url(server, "/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }

  test("existing id returns 204 with no body", async () => {
    const created = await createItem("to-delete");
    const res = await fetch(url(server, `/items/${created.id}`), { method: "DELETE" });
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");
  });

  test("missing id returns 404", async () => {
    const res = await fetch(url(server, "/items/nonexistent-delete-id"), { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = (await json(res)) as { error: { status: number; message: string } };
    expect(body.error.status).toBe(404);
  });

  test("deleting twice returns 404 on second call", async () => {
    const created = await createItem("double-delete");
    const first = await fetch(url(server, `/items/${created.id}`), { method: "DELETE" });
    expect(first.status).toBe(204);
    const second = await fetch(url(server, `/items/${created.id}`), { method: "DELETE" });
    expect(second.status).toBe(404);
  });
});
