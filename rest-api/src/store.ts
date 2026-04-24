import type { Item, CreateItemInput, UpdateItemInput } from "./types";

export class ItemStore {
  private readonly items: Map<string, Item> = new Map();

  list(): Item[] {
    return Array.from(this.items.values());
  }

  get(id: string): Item | undefined {
    return this.items.get(id);
  }

  create(input: CreateItemInput): Item {
    const now = new Date().toISOString();
    const item: Item = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.items.set(item.id, item);
    return item;
  }

  update(id: string, input: UpdateItemInput): Item | undefined {
    const existing = this.items.get(id);
    if (existing === undefined) {
      return undefined;
    }
    const updated: Item = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) {
      updated.name = input.name;
    }
    if ("description" in input) {
      updated.description = input.description ?? null;
    }
    this.items.set(id, updated);
    return updated;
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }

  clear(): void {
    this.items.clear();
  }
}
