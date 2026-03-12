import { RGBA, SyntaxStyle, type StyleDefinition } from "@opentui/core";
import type { ThemeColors } from "@/theme/types.ts";

export function createMarkdownSyntaxStyle(colors: ThemeColors, isDark: boolean): SyntaxStyle {
  const palette = isDark ? {
    heading:  "#94e2d5",
    keyword:  "#cba6f7",
    string:   "#a6e3a1",
    comment:  "#9399b2",
    variable: "#cdd6f4",
    func:     "#89b4fa",
    number:   "#fab387",
    type:     "#f9e2af",
    operator: "#89dceb",
    punct:    "#9399b2",
    property: "#89b4fa",
    link:     "#89b4fa",
    list:     "#a6adc8",
    raw:      "#f2cdcd",
    bool:     "#fab387",
    constant: "#fab387",
  } : {
    heading:  "#179299",
    keyword:  "#8839ef",
    string:   "#40a02b",
    comment:  "#7c7f93",
    variable: "#4c4f69",
    func:     "#1e66f5",
    number:   "#fe640b",
    type:     "#df8e1d",
    operator: "#04a5e5",
    punct:    "#7c7f93",
    property: "#1e66f5",
    link:     "#1e66f5",
    list:     "#6c6f85",
    raw:      "#dd7878",
    bool:     "#fe640b",
    constant: "#fe640b",
  };

  void colors;

  return SyntaxStyle.fromStyles({
    "markup.heading.1": { fg: RGBA.fromHex(palette.heading), bold: true },
    "markup.heading.2": { fg: RGBA.fromHex(palette.heading), bold: true },
    "markup.heading.3": { fg: RGBA.fromHex(palette.heading), bold: true },
    "markup.heading.4": { fg: RGBA.fromHex(palette.heading) },
    "markup.heading.5": { fg: RGBA.fromHex(palette.heading) },
    "markup.heading.6": { fg: RGBA.fromHex(palette.heading), dim: true },
    "markup.raw": { fg: RGBA.fromHex(palette.raw) },
    "markup.list": { fg: RGBA.fromHex(palette.list) },
    "markup.link": { fg: RGBA.fromHex(palette.link), underline: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": {},
    "punctuation.special": { fg: RGBA.fromHex(palette.punct) },
    conceal: { fg: RGBA.fromHex(palette.raw) },
    keyword: { fg: RGBA.fromHex(palette.keyword), bold: true },
    string: { fg: RGBA.fromHex(palette.string) },
    comment: { fg: RGBA.fromHex(palette.comment), italic: true },
    variable: { fg: RGBA.fromHex(palette.variable) },
    function: { fg: RGBA.fromHex(palette.func) },
    number: { fg: RGBA.fromHex(palette.number) },
    type: { fg: RGBA.fromHex(palette.type) },
    operator: { fg: RGBA.fromHex(palette.operator) },
    punctuation: { fg: RGBA.fromHex(palette.punct) },
    constant: { fg: RGBA.fromHex(palette.constant) },
    property: { fg: RGBA.fromHex(palette.property) },
    boolean: { fg: RGBA.fromHex(palette.bool) },
    default: { fg: RGBA.fromHex(palette.variable) },
  });
}

export function createDimmedSyntaxStyle(
  baseStyle: SyntaxStyle,
  opacity: number = 0.6,
): SyntaxStyle {
  const allStyles = baseStyle.getAllStyles();
  const dimmedRecord: Record<string, StyleDefinition> = {};

  for (const [name, def] of allStyles) {
    const dimmedDef: StyleDefinition = { ...def };
    if (dimmedDef.fg) {
      dimmedDef.fg = RGBA.fromValues(
        dimmedDef.fg.r,
        dimmedDef.fg.g,
        dimmedDef.fg.b,
        dimmedDef.fg.a * opacity,
      );
    }
    dimmedRecord[name] = dimmedDef;
  }

  return SyntaxStyle.fromStyles(dimmedRecord);
}
