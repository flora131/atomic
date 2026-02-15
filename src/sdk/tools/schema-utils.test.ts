import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { zodToJsonSchema } from "./schema-utils";

describe("zodToJsonSchema", () => {
  test("converts simple string schema", () => {
    const schema = z.string();
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("string");
  });

  test("converts simple number schema", () => {
    const schema = z.number();
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("number");
  });

  test("converts simple boolean schema", () => {
    const schema = z.boolean();
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("boolean");
  });

  test("converts object schema with properties", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      isActive: z.boolean(),
    });
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    expect((result.properties as any).name).toBeDefined();
    expect((result.properties as any).age).toBeDefined();
    expect((result.properties as any).isActive).toBeDefined();
  });

  test("converts object schema with required fields", () => {
    const schema = z.object({
      required1: z.string(),
      required2: z.number(),
    });
    const result = zodToJsonSchema(schema);
    
    expect(result.required).toBeDefined();
    expect(Array.isArray(result.required)).toBe(true);
    if (Array.isArray(result.required)) {
      const sorted = [...result.required].sort();
      expect(JSON.stringify(sorted)).toBe(JSON.stringify(["required1", "required2"]));
    }
  });

  test("converts object schema with optional fields", () => {
    const schema = z.object({
      required: z.string(),
      optional: z.string().optional(),
    });
    const result = zodToJsonSchema(schema);
    
    expect(result.required).toBeDefined();
    expect(Array.isArray(result.required)).toBe(true);
    if (Array.isArray(result.required)) {
      expect(JSON.stringify(result.required)).toBe(JSON.stringify(["required"]));
    }
  });

  test("converts array schema", () => {
    const schema = z.array(z.string());
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("array");
    expect(result.items).toBeDefined();
    expect((result.items as any).type).toBe("string");
  });

  test("converts nested object schema", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
      metadata: z.object({
        created: z.string(),
        updated: z.string(),
      }),
    });
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    expect((result.properties as any).user).toBeDefined();
    expect((result.properties as any).user.type).toBe("object");
    expect((result.properties as any).metadata).toBeDefined();
    expect((result.properties as any).metadata.type).toBe("object");
  });

  test("converts array of objects", () => {
    const schema = z.array(
      z.object({
        id: z.number(),
        name: z.string(),
      })
    );
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("array");
    expect(result.items).toBeDefined();
    expect((result.items as any).type).toBe("object");
    expect((result.items as any).properties).toBeDefined();
  });

  test("converts schema with string constraints", () => {
    const schema = z.string().min(3).max(10);
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("string");
    expect(result.minLength).toBe(3);
    expect(result.maxLength).toBe(10);
  });

  test("converts schema with number constraints", () => {
    const schema = z.number().min(1).max(100);
    const result = zodToJsonSchema(schema);
    
    expect(result.type).toBe("number");
    expect(result.minimum).toBe(1);
    expect(result.maximum).toBe(100);
  });

  test("converts enum schema", () => {
    const schema = z.enum(["option1", "option2", "option3"]);
    const result = zodToJsonSchema(schema);
    
    expect(result.enum).toBeDefined();
    expect(Array.isArray(result.enum)).toBe(true);
    if (Array.isArray(result.enum)) {
      expect(JSON.stringify(result.enum)).toBe(JSON.stringify(["option1", "option2", "option3"]));
    }
  });
});
