import { test, expect, describe } from "bun:test";
import { Fragment } from "react";

import { Box, Text } from "../components.tsx";
import { compile } from "./parser.ts";

describe("compile", () => {
  describe("primitives", () => {
    test("string node returns the string", () => {
      expect(compile("hello")).toBe("hello");
    });

    test("number node coerces to string", () => {
      expect(compile(42)).toBe("42");
    });

    test("null/undefined/false render to empty string", () => {
      expect(compile(null)).toBe("");
      expect(compile(undefined)).toBe("");
      expect(compile(false)).toBe("");
      expect(compile(true)).toBe("");
    });

    test("array of nodes joins without separator", () => {
      expect(compile(["a", "b", "c"])).toBe("abc");
    });
  });

  describe("Box and Text", () => {
    test("plain Text emits children with no style", () => {
      expect(compile(<Text>hi</Text>)).toBe("hi");
    });

    test("styled Box wraps children in #[…] markup", () => {
      expect(compile(<Box bg="blue">hi</Box>)).toBe("#[bg=blue]hi");
    });

    test("padding emits leading and trailing spaces", () => {
      expect(compile(<Box padding={2}>x</Box>)).toBe("  x  ");
    });

    test("paddingLeft and paddingRight are independent", () => {
      expect(compile(<Box paddingLeft={1} paddingRight={3}>x</Box>)).toBe(
        " x   ",
      );
    });

    test("padding shorthand overrides paddingLeft/paddingRight", () => {
      expect(
        compile(
          <Box padding={1} paddingLeft={5} paddingRight={5}>
            x
          </Box>,
        ),
      ).toBe(" x ");
    });

    test("nested Box concatenates style markup before each segment", () => {
      const tree = (
        <Box bg="black">
          <Text fg="red">A</Text>
          <Text fg="green">B</Text>
        </Box>
      );
      expect(compile(tree)).toBe("#[bg=black]#[fg=red]A#[fg=green]B");
    });

    test("gap inserts spacing+style between siblings", () => {
      const tree = (
        <Box bg="black" gap={1}>
          <Text>A</Text>
          <Text>B</Text>
        </Box>
      );
      expect(compile(tree)).toBe("#[bg=black]A#[bg=black] B");
    });

    test("bold flag emitted alongside fg/bg", () => {
      expect(compile(<Text fg="red" bold>X</Text>)).toBe("#[fg=red bold]X");
    });
  });

  describe("React composition", () => {
    test("function components are called and recursed", () => {
      const Greeting = ({ name }: { name: string }) => <Text>hi {name}</Text>;
      expect(compile(<Greeting name="world" />)).toBe("hi world");
    });

    test("Fragment flattens children", () => {
      expect(
        compile(
          <Fragment>
            <Text>A</Text>
            <Text>B</Text>
          </Fragment>,
        ),
      ).toBe("AB");
    });

    test("conditional rendering — false branch emits nothing", () => {
      const show = false;
      expect(compile(<Text>{show ? "yes" : null}</Text>)).toBe("");
    });

    test("array of elements via .map() compiles in order", () => {
      const items = ["a", "b", "c"];
      expect(
        compile(
          <Text>
            {items.map((s, i) => (
              <Text key={i}>{s}</Text>
            ))}
          </Text>,
        ),
      ).toBe("abc");
    });
  });

  describe("realistic footer fragments", () => {
    test("workflow-style left pill + name (space-separated style attrs)", () => {
      const tree = (
        <Box bg="blue" paddingLeft={1} paddingRight={1}>
          <Text fg="black" bold>
            agent-1
          </Text>
        </Box>
      );
      expect(compile(tree)).toBe("#[bg=blue] #[fg=black bold]agent-1 ");
    });
  });
});
