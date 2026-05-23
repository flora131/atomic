import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import type { Store } from "./store.js";
import { store as defaultStore } from "./store.js";
import type { PiCustomOverlayFactory, PiCustomOverlayOptions, PiKeybindings, PiTheme } from "../extension/wiring.js";

export interface StageCustomUiRequest<T = unknown> {
  readonly id: string;
  readonly runId: string;
  readonly stageId: string;
  readonly factory: PiCustomOverlayFactory<T>;
  readonly options?: PiCustomOverlayOptions;
  readonly createdAt: number;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface StageCustomUiHost {
  showCustomUi(request: StageCustomUiRequest): void;
}

function key(runId: string, stageId: string): string {
  return `${runId}\0${stageId}`;
}

function nextRequestId(): string {
  return `stage-ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class StageUiBroker {
  private readonly store: Store;
  private readonly pending = new Map<string, StageCustomUiRequest>();
  private readonly hosts = new Map<string, StageCustomUiHost>();

  constructor(store: Store = defaultStore) {
    this.store = store;
  }

  registerHost(runId: string, stageId: string, host: StageCustomUiHost): () => void {
    const hostKey = key(runId, stageId);
    this.hosts.set(hostKey, host);
    const request = this.pending.get(hostKey);
    if (request) host.showCustomUi(request);
    return () => {
      if (this.hosts.get(hostKey) === host) this.hosts.delete(hostKey);
    };
  }

  requestCustomUi<T>(
    runId: string,
    stageId: string,
    factory: PiCustomOverlayFactory<T>,
    options?: PiCustomOverlayOptions,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new Error("pi-workflows: stage UI request aborted"));
    }
    const hostKey = key(runId, stageId);
    const existing = this.pending.get(hostKey);
    if (existing) {
      return Promise.reject(new Error(`pi-workflows: stage ${stageId} already has a pending custom UI request`));
    }

    let request!: StageCustomUiRequest<T>;
    const promise = new Promise<T>((resolve, reject) => {
      request = {
        id: nextRequestId(),
        runId,
        stageId,
        factory,
        ...(options !== undefined ? { options } : {}),
        createdAt: Date.now(),
        resolve,
        reject,
      };
    });

    this.pending.set(hostKey, request);
    this.store.recordStageAwaitingInput(runId, stageId, true, request.createdAt);
    this.hosts.get(hostKey)?.showCustomUi(request);

    const onAbort = (): void => {
      this.reject(request, signal?.reason ?? new Error("pi-workflows: stage UI request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    return promise.finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });
  }

  resolve<T>(request: StageCustomUiRequest<T>, value: T): void {
    const hostKey = key(request.runId, request.stageId);
    if (this.pending.get(hostKey)?.id !== request.id) return;
    this.pending.delete(hostKey);
    this.store.recordStageAwaitingInput(request.runId, request.stageId, false);
    request.resolve(value);
  }

  reject(request: StageCustomUiRequest, reason: unknown): void {
    const hostKey = key(request.runId, request.stageId);
    if (this.pending.get(hostKey)?.id !== request.id) return;
    this.pending.delete(hostKey);
    this.store.recordStageAwaitingInput(request.runId, request.stageId, false);
    request.reject(reason);
  }
}

export interface MountedStageCustomUi {
  readonly request: StageCustomUiRequest;
  readonly component: Component & { dispose?(): void };
}

export async function mountStageCustomUi(
  request: StageCustomUiRequest,
  tui: TUI,
  theme: PiTheme,
  keybindings: PiKeybindings,
  broker: StageUiBroker,
  onDone?: () => void,
): Promise<MountedStageCustomUi> {
  const rawComponent = await request.factory(
    tui as unknown as Parameters<StageCustomUiRequest["factory"]>[0],
    theme,
    keybindings,
    (result: unknown) => {
      broker.resolve(request, result);
      onDone?.();
    },
  );
  const component: Component & { dispose?(): void } & Partial<Focusable> = {
    render: (width) => rawComponent.render(width),
    ...(rawComponent.handleInput !== undefined
      ? { handleInput: (data: string) => rawComponent.handleInput?.(data) }
      : {}),
    invalidate: () => rawComponent.invalidate?.(),
    ...(rawComponent.dispose !== undefined ? { dispose: () => rawComponent.dispose?.() } : {}),
  };
  if ("focused" in rawComponent) {
    Object.defineProperty(component, "focused", {
      get: () => (rawComponent as Component & Partial<Focusable>).focused,
      set: (value: boolean) => {
        (rawComponent as Component & Partial<Focusable>).focused = value;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return { request, component };
}

export const stageUiBroker = new StageUiBroker();
