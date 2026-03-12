export interface BackgroundUpdateFlushStartState {
  hasFlushInFlight: boolean;
  isStreaming: boolean;
  pendingUpdateCount: number;
}

export function shouldStartBackgroundUpdateFlush(
  state: BackgroundUpdateFlushStartState,
): boolean {
  return !state.hasFlushInFlight
    && !state.isStreaming
    && state.pendingUpdateCount > 0;
}

export interface BackgroundUpdateFlushFollowUpState {
  sendSucceeded: boolean;
  isStreaming: boolean;
  pendingUpdateCount: number;
}

export function shouldScheduleBackgroundUpdateFollowUpFlush(
  state: BackgroundUpdateFlushFollowUpState,
): boolean {
  return state.sendSucceeded
    && !state.isStreaming
    && state.pendingUpdateCount > 0;
}
