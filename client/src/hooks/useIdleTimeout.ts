import { useEffect, useRef } from 'react';
import { useAuth } from './useAuth';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const EVENTS = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];

export function useIdleTimeout() {
  const { logout, isAuthenticated } = useAuth();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!isAuthenticated) return;

    const resetTimer = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        logout();
      }, IDLE_TIMEOUT_MS);
    };

    resetTimer();
    EVENTS.forEach(event => window.addEventListener(event, resetTimer, { passive: true }));

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      EVENTS.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [isAuthenticated, logout]);
}
