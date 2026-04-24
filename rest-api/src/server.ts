import { ItemStore } from "./store";
import {
  BadRequestError,
  NotFoundError,
  errorResponse,
  jsonResponse,
} from "./errors";
import { parseCreateItemInput, parseUpdateItemInput } from "./types";

type ServerOptions = {
  port?: number;
  store?: ItemStore;
};

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new BadRequestError("Invalid JSON body");
  }
}

export function createServer(options?: ServerOptions): ReturnType<typeof Bun.serve> {
  const port = options?.port ?? 3000;
  const store = options?.store ?? new ItemStore();

  return Bun.serve({
    port,
    routes: {
      "/items": {
        GET: (_req) => {
          try {
            return jsonResponse(store.list());
          } catch (err) {
            return errorResponse(err);
          }
        },
        POST: async (req) => {
          try {
            const body = await parseJsonBody(req);
            let input;
            try {
              input = parseCreateItemInput(body);
            } catch (err) {
              throw new BadRequestError(err instanceof Error ? err.message : String(err));
            }
            const created = store.create(input);
            return jsonResponse(created, { status: 201 });
          } catch (err) {
            return errorResponse(err);
          }
        },
      },
      "/items/:id": {
        GET: (req: Bun.BunRequest<"/items/:id">) => {
          try {
            const { id } = req.params;
            const item = store.get(id);
            if (item === undefined) {
              throw new NotFoundError(`Item ${id} not found`);
            }
            return jsonResponse(item);
          } catch (err) {
            return errorResponse(err);
          }
        },
        PUT: async (req: Bun.BunRequest<"/items/:id">) => {
          try {
            const { id } = req.params;
            const body = await parseJsonBody(req);
            let input;
            try {
              input = parseUpdateItemInput(body);
            } catch (err) {
              throw new BadRequestError(err instanceof Error ? err.message : String(err));
            }
            const updated = store.update(id, input);
            if (updated === undefined) {
              throw new NotFoundError(`Item ${id} not found`);
            }
            return jsonResponse(updated);
          } catch (err) {
            return errorResponse(err);
          }
        },
        DELETE: (req: Bun.BunRequest<"/items/:id">) => {
          try {
            const { id } = req.params;
            const removed = store.remove(id);
            if (!removed) {
              throw new NotFoundError(`Item ${id} not found`);
            }
            return new Response(null, { status: 204 });
          } catch (err) {
            return errorResponse(err);
          }
        },
      },
    },
    fetch: (_req) => {
      return errorResponse(new NotFoundError("Route not found"));
    },
  });
}
