import React, { useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { useTheme } from "@/theme/index.tsx";
import { MISC } from "@/theme/icons.ts";
import { SPACING } from "@/theme/spacing.ts";
import type { AtomicHeaderProps } from "@/state/chat/shared/types/index.ts";

const ATOMIC_BLOCK_LOGO = [
  "█▀▀█ ▀▀█▀▀ █▀▀█ █▀▄▀█ ▀█▀ █▀▀",
  "█▄▄█   █   █  █ █ ▀ █  █  █  ",
  "▀  ▀   ▀   ▀▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀",
];

function buildAtomicGradient(isDark: boolean): string[] {
  return isDark
    ? [
        "#f5e0dc",
        "#f2cdcd",
        "#f5c2e7",
        "#cba6f7",
        "#b4befe",
        "#89b4fa",
        "#74c7ec",
        "#89dceb",
        "#94e2d5",
      ]
    : [
        "#dc8a78",
        "#dd7878",
        "#ea76cb",
        "#8839ef",
        "#7287fd",
        "#1e66f5",
        "#209fb5",
        "#04a5e5",
        "#179299",
      ];
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    parseInt(normalized.substring(0, 2), 16),
    parseInt(normalized.substring(2, 4), 16),
    parseInt(normalized.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

function interpolateGradient(gradient: string[], t: number): string {
  if (gradient.length === 0) return "#ffffff";
  if (gradient.length === 1) return gradient[0] as string;

  const clampedT = Math.max(0, Math.min(1, t));
  const gradientPosition = clampedT * (gradient.length - 1);
  const lower = Math.floor(gradientPosition);
  const upper = Math.min(lower + 1, gradient.length - 1);
  const fraction = gradientPosition - lower;

  const [r1, g1, b1] = hexToRgb(gradient[lower] as string);
  const [r2, g2, b2] = hexToRgb(gradient[upper] as string);

  return rgbToHex(
    r1 + (r2 - r1) * fraction,
    g1 + (g2 - g1) * fraction,
    b1 + (b2 - b1) * fraction,
  );
}

function GradientText({
  text,
  gradient,
}: {
  text: string;
  gradient: string[];
}): React.ReactNode {
  const chars = [...text];
  const length = chars.length;

  return (
    <text>
      {chars.map((char, index) => {
        const color = interpolateGradient(
          gradient,
          length > 1 ? index / (length - 1) : 0,
        );
        return (
          <span key={index} fg={color}>
            {char}
          </span>
        );
      })}
    </text>
  );
}

export function AtomicHeader({
  version = "0.1.0",
  model = "",
  tier = "",
  workingDir = "~/",
}: AtomicHeaderProps): React.ReactNode {
  const { theme } = useTheme();
  const { width: terminalWidth } = useTerminalDimensions();
  const gradient = useMemo(
    () => buildAtomicGradient(theme.isDark),
    [theme.isDark],
  );
  const showBlockLogo = terminalWidth >= 70;

  return (
    <box
      flexDirection="row"
      alignItems="flex-start"
      marginBottom={SPACING.ELEMENT}
      marginLeft={SPACING.CONTAINER_PAD}
      flexShrink={0}
    >
      {showBlockLogo && (
        <box flexDirection="column" marginRight={SPACING.GUTTER}>
          {ATOMIC_BLOCK_LOGO.map((line, index) => (
            <GradientText key={index} text={line} gradient={gradient} />
          ))}
        </box>
      )}

      <box flexDirection="column" paddingTop={SPACING.NONE}>
        <text>
          <span fg={theme.colors.foreground}>v{version}</span>
        </text>
        <text fg={theme.colors.muted}>
          {model} {MISC.separator} {tier}
        </text>
        <text fg={theme.colors.muted}>{workingDir}</text>
      </box>
    </box>
  );
}
