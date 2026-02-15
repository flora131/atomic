/**
 * Tests for shouldRotateId — determines if telemetry ID should rotate
 * based on month/year boundary crossing.
 */
import { describe, expect, test } from "bun:test";
import { shouldRotateId } from "./telemetry.ts";
import type { TelemetryState } from "./types.ts";

/**
 * Factory helper to create a valid TelemetryState with a given rotatedAt date.
 */
function makeTelemetryState(rotatedAt: string): TelemetryState {
  return {
    enabled: true,
    consentGiven: true,
    anonymousId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    createdAt: "2025-01-01T00:00:00.000Z",
    rotatedAt,
  };
}

describe("shouldRotateId", () => {
  test("returns false when rotatedAt is in the current month and year", () => {
    // Use the current date's month/year so it always matches "now"
    const now = new Date();
    const currentMonthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12, 0, 0)
    );
    const state = makeTelemetryState(currentMonthDate.toISOString());

    expect(shouldRotateId(state)).toBe(false);
  });

  test("returns true when rotatedAt is in a different month of the same year", () => {
    const now = new Date();
    // Pick a month that is definitely not the current month
    const differentMonth = now.getUTCMonth() === 0 ? 6 : now.getUTCMonth() - 1;
    const pastDate = new Date(
      Date.UTC(now.getUTCFullYear(), differentMonth, 10, 8, 30, 0)
    );
    const state = makeTelemetryState(pastDate.toISOString());

    expect(shouldRotateId(state)).toBe(true);
  });

  test("returns true when rotatedAt is in a different year but the same month number", () => {
    const now = new Date();
    // Same month, previous year
    const pastYearDate = new Date(
      Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), 15, 12, 0, 0)
    );
    const state = makeTelemetryState(pastYearDate.toISOString());

    expect(shouldRotateId(state)).toBe(true);
  });

  test("returns true when rotatedAt crosses a year boundary (December to January)", () => {
    const now = new Date();
    // Force a date in December of the previous year; unless we are currently
    // in December of that same year this will always differ in year or month.
    const decemberLastYear = new Date(
      Date.UTC(now.getUTCFullYear() - 1, 11, 31, 23, 59, 59)
    );
    const state = makeTelemetryState(decemberLastYear.toISOString());

    // Either the year or the month (or both) will differ from "now"
    expect(shouldRotateId(state)).toBe(true);
  });

  test("returns false when rotatedAt is the very start of the current month", () => {
    const now = new Date();
    // First millisecond of the current month in UTC
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
    );
    const state = makeTelemetryState(startOfMonth.toISOString());

    expect(shouldRotateId(state)).toBe(false);
  });

  test("returns true when rotatedAt is the last millisecond of the previous month", () => {
    const now = new Date();
    // Last millisecond before the current month started
    const endOfPrevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0) - 1
    );
    const state = makeTelemetryState(endOfPrevMonth.toISOString());

    // The previous month's year/month will differ from the current month
    expect(shouldRotateId(state)).toBe(true);
  });
});
