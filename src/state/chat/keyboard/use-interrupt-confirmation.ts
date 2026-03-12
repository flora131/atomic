import { useCallback, useEffect, useRef, useState } from "react";

export interface UseInterruptConfirmationResult {
  clearInterruptConfirmation: () => void;
  ctrlCPressed: boolean;
  interruptCount: number;
  scheduleInterruptConfirmation: (nextCount: number) => void;
}

export function useInterruptConfirmation(): UseInterruptConfirmationResult {
  const [interruptCount, setInterruptCount] = useState(0);
  const [ctrlCPressed, setCtrlCPressed] = useState(false);
  const interruptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInterruptConfirmation = useCallback(() => {
    setInterruptCount(0);
    setCtrlCPressed(false);
    if (interruptTimeoutRef.current) {
      clearTimeout(interruptTimeoutRef.current);
      interruptTimeoutRef.current = null;
    }
  }, []);

  const scheduleInterruptConfirmation = useCallback((nextCount: number) => {
    setInterruptCount(nextCount);
    setCtrlCPressed(true);
    if (interruptTimeoutRef.current) {
      clearTimeout(interruptTimeoutRef.current);
    }
    interruptTimeoutRef.current = setTimeout(() => {
      clearInterruptConfirmation();
    }, 1000);
  }, [clearInterruptConfirmation]);

  useEffect(() => {
    return () => {
      if (interruptTimeoutRef.current) {
        clearTimeout(interruptTimeoutRef.current);
      }
    };
  }, []);

  return {
    clearInterruptConfirmation,
    ctrlCPressed,
    interruptCount,
    scheduleInterruptConfirmation,
  };
}
