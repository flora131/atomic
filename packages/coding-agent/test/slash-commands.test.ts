import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

describe("BUILTIN_SLASH_COMMANDS", () => {
	it("registers rewind as a built-in read-only command", () => {
		expect(BUILTIN_SLASH_COMMANDS).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "rewind", description: expect.stringContaining("checkpoint") })]),
		);
	});
});
