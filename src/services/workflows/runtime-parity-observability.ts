export interface RuntimeParityMetricsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, number[]>;
}

interface RuntimeParityMetricsState {
  counters: Map<string, number>;
  gauges: Map<string, number>;
  histograms: Map<string, number[]>;
}

const state: RuntimeParityMetricsState = {
  counters: new Map(),
  gauges: new Map(),
  histograms: new Map(),
};

const DEBUG_ENABLED = () => {
  const debugValue = process.env.DEBUG?.trim().toLowerCase();
  if (debugValue) {
    return debugValue === "1" || debugValue === "true" || debugValue === "on";
  }
  return process.env.ATOMIC_WORKFLOW_DEBUG === "1";
};

function metricKey(name: string, labels?: Record<string, string | number | boolean | undefined>): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name;
  }

  const encoded = Object.entries(labels)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, value]) => `${label}=${String(value)}`)
    .join(",");

  return encoded.length > 0 ? `${name}{${encoded}}` : name;
}

export function incrementRuntimeParityCounter(
  name: string,
  labels?: Record<string, string | number | boolean | undefined>,
  amount = 1,
): number {
  const key = metricKey(name, labels);
  const next = (state.counters.get(key) ?? 0) + amount;
  state.counters.set(key, next);
  return next;
}

export function setRuntimeParityGauge(
  name: string,
  value: number,
  labels?: Record<string, string | number | boolean | undefined>,
): void {
  const key = metricKey(name, labels);
  state.gauges.set(key, value);
}

export function observeRuntimeParityHistogram(
  name: string,
  value: number,
  labels?: Record<string, string | number | boolean | undefined>,
): void {
  const key = metricKey(name, labels);
  const values = state.histograms.get(key) ?? [];
  values.push(value);
  state.histograms.set(key, values);
}

export function getRuntimeParityMetricsSnapshot(): RuntimeParityMetricsSnapshot {
  const counters: Record<string, number> = {};
  const gauges: Record<string, number> = {};
  const histograms: Record<string, number[]> = {};

  for (const [key, value] of state.counters) {
    counters[key] = value;
  }
  for (const [key, value] of state.gauges) {
    gauges[key] = value;
  }
  for (const [key, value] of state.histograms) {
    histograms[key] = [...value];
  }

  return { counters, gauges, histograms };
}

export function resetRuntimeParityMetrics(): void {
  state.counters.clear();
  state.gauges.clear();
  state.histograms.clear();
}

export function runtimeParityDebug(
  phase: string,
  data: Record<string, unknown>,
): void {
  if (!DEBUG_ENABLED()) {
    return;
  }
  console.debug(`[workflow.runtime.parity] ${phase} ${JSON.stringify(data)}`);
}
