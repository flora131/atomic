# REST API

A minimal REST API demo built on Bun.serve with an in-memory `Item` store.

## Requirements

- Bun >= 1.1

## Install

```sh
cd rest-api
bun install
```

## Run

```sh
# production
bun run start

# hot reload dev
bun run dev
```

Server listens on `http://localhost:3000`.

## Endpoints

### GET /items

List all items. Returns array of `Item`.

### GET /items/:id

Get one item by ID. Returns `Item`. 404 if not found.

### POST /items

Create item. Returns created `Item` with status 201.

Body:

```json
{ "name": "Laptop Stand", "description": "Adjustable aluminum stand" }
```

`name` required, non-empty string. `description` optional string or null.

### PUT /items/:id

Update item. Returns updated `Item`. 404 if not found.

Body:

```json
{ "name": "Laptop Stand Pro", "description": null }
```

`name` and `description` both optional; at least one must be provided. `description` accepts string or null.

### DELETE /items/:id

Remove item. Returns 204 No Content. 404 if not found.

## Item Shape

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Laptop Stand",
  "description": "Adjustable aluminum stand",
  "createdAt": "2026-04-24T12:00:00.000Z",
  "updatedAt": "2026-04-24T12:00:00.000Z"
}
```

Fields: `id` (UUID), `name` (string), `description` (string | null), `createdAt` (ISO 8601), `updatedAt` (ISO 8601).

## Example

```sh
# list all items
curl http://localhost:3000/items

# create item
curl -X POST http://localhost:3000/items \
  -H "Content-Type: application/json" \
  -d '{"name": "Laptop Stand", "description": "Adjustable aluminum stand"}'

# get one item
curl http://localhost:3000/items/550e8400-e29b-41d4-a716-446655440000

# update item
curl -X PUT http://localhost:3000/items/550e8400-e29b-41d4-a716-446655440000 \
  -H "Content-Type: application/json" \
  -d '{"name": "Laptop Stand Pro", "description": null}'

# delete item
curl -X DELETE http://localhost:3000/items/550e8400-e29b-41d4-a716-446655440000
```

## Error Responses

All errors return JSON with shape:

```json
{ "error": { "status": 400, "message": "Invalid request body: name is required" } }
```

`status` mirrors the HTTP status code. Common codes: 400 (bad request), 404 (not found).

## Test

```sh
bun test
```
