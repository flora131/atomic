export const catppuccinMocha = {
  rosewater: "#f5e0dc",
  flamingo: "#f2cdcd",
  pink: "#f5c2e7",
  mauve: "#cba6f7",
  red: "#f38ba8",
  maroon: "#eba0ac",
  peach: "#fab387",
  yellow: "#f9e2af",
  green: "#a6e3a1",
  teal: "#94e2d5",
  sky: "#89dceb",
  sapphire: "#74c7ec",
  blue: "#89b4fa",
  lavender: "#b4befe",
  text: "#cdd6f4",
  subtext1: "#bac2de",
  subtext0: "#a6adc8",
  overlay2: "#9399b2",
  overlay1: "#7f849c",
  overlay0: "#6c7086",
  surface2: "#585b70",
  surface1: "#45475a",
  surface0: "#313244",
  base: "#1e1e2e",
  mantle: "#181825",
  crust: "#11111b",
} as const;

export const catppuccinLatte = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  text: "#4c4f69",
  subtext1: "#5c5f77",
  subtext0: "#6c6f85",
  overlay2: "#7c7f93",
  overlay1: "#8c8fa1",
  overlay0: "#9ca0b0",
  surface2: "#acb0be",
  surface1: "#bcc0cc",
  surface0: "#ccd0da",
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
} as const;

export interface CatppuccinPalette {
  readonly rosewater: string;
  readonly flamingo: string;
  readonly pink: string;
  readonly mauve: string;
  readonly red: string;
  readonly maroon: string;
  readonly peach: string;
  readonly yellow: string;
  readonly green: string;
  readonly teal: string;
  readonly sky: string;
  readonly sapphire: string;
  readonly blue: string;
  readonly lavender: string;
  readonly text: string;
  readonly subtext1: string;
  readonly subtext0: string;
  readonly overlay2: string;
  readonly overlay1: string;
  readonly overlay0: string;
  readonly surface2: string;
  readonly surface1: string;
  readonly surface0: string;
  readonly base: string;
  readonly mantle: string;
  readonly crust: string;
}

export function getCatppuccinPalette(isDark: boolean): CatppuccinPalette {
  return isDark ? catppuccinMocha : catppuccinLatte;
}
