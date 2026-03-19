export interface BackgroundUpdateFlushStartState {
  hasFlushInFlight: boolean;
  isAgentOnlyStream: boolean;
  isStreaming: boolean;
  pendingUpdateCount: number;
}

export function shouldStartBackgroundUpdateFlush(
  state: BackgroundUpdateFlushStartState,
): boolean {
  const streamBlocksFlush = state.isStreaming && !state.isAgentOnlyStream;
  return !state.hasFlushInFlight
    && !streamBlocksFlush
    && state.pendingUpdateCount > 0;
}

export interface BackgroundUpdateFlushFollowUpState {
  isAgentOnlyStream: boolean;
  sendSucceeded: boolean;
  isStreaming: boolean;
  pendingUpdateCount: number;
}

export function shouldScheduleBackgroundUpdateFollowUpFlush(
  state: BackgroundUpdateFlushFollowUpState,
): boolean {
  const streamBlocksFlush = state.isStreaming && !state.isAgentOnlyStream;
  return state.sendSucceeded
    && !streamBlocksFlush
    && state.pendingUpdateCount > 0;
}
