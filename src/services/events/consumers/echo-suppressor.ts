/**
 * Echo Suppression Service
 *
 * Filters duplicate text that appears when SDKs echo tool results
 * back as part of the assistant's text stream. This replaces the
 * inline echo suppression logic previously in handleStreamMessage().
 *
 * The suppressor maintains a FIFO queue of expected echo targets.
 * When a tool completes, its result text is registered as an expected echo.
 * Subsequent text deltas are checked against the accumulated text;
 * if the text matches an expected echo prefix, it is suppressed.
 */
export class EchoSuppressor {
    private suppressTargets: string[] = [];  // FIFO queue of expected echoes
    private accumulator = "";  // Accumulated text being checked against targets
    private activeTarget: string | null = null;  // Currently matching target

    /**
     * Register a tool result that may be echoed by the SDK.
     * @param resultText - The tool result text to watch for
     */
    expectEcho(resultText: string): void {
        if (resultText.trim().length > 0) {
            this.suppressTargets.push(resultText);
        }
    }

    /**
     * Filter a text delta, returning the non-echoed portion.
     * Returns empty string if the entire delta is suppressed.
     * Returns the full delta if no echo is detected.
     *
     * @param delta - Text delta to filter
     * @returns Filtered delta (may be empty if fully suppressed)
     */
    filterDelta(delta: string): string {
        if (this.suppressTargets.length === 0 && this.activeTarget === null) {
            return delta;
        }

        // If we don't have an active target, try the next one from the queue
        if (this.activeTarget === null && this.suppressTargets.length > 0) {
            this.activeTarget = this.suppressTargets.shift()!;
            this.accumulator = "";
        }

        if (this.activeTarget === null) {
            return delta;
        }

        // Append delta to accumulator and check against target
        this.accumulator += delta;

        // If accumulator exactly prefixes or matches the target, suppress
        if (this.activeTarget.startsWith(this.accumulator)) {
            // Still accumulating — full delta is suppressed
            if (this.accumulator.length === this.activeTarget.length) {
                // Complete match — echo fully consumed
                this.activeTarget = null;
                this.accumulator = "";
            }
            return "";
        }

        // Accumulator diverged from target — not an echo
        // Return the full accumulated text (it was not an echo after all)
        const result = this.accumulator;
        this.activeTarget = null;
        this.accumulator = "";
        // We already consumed previous deltas that were part of accumulator
        // but those were returned as "" previously, so we need to return the
        // accumulated text minus the current delta (which hasn't been returned yet)
        // Actually, the accumulator includes all previously suppressed deltas + current delta.
        // Since previous deltas were suppressed (returned ""), we need to return ALL accumulated text.
        return result;
    }

    /**
     * Reset all suppression state. Called on stream end, error, or abort.
     */
    reset(): void {
        this.suppressTargets = [];
        this.accumulator = "";
        this.activeTarget = null;
    }

    /**
     * Check if there are any pending suppression targets.
     */
    get hasPendingTargets(): boolean {
        return this.suppressTargets.length > 0 || this.activeTarget !== null;
    }
}
