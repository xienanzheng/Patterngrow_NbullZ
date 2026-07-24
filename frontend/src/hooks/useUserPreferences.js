import { useCallback, useEffect, useRef, useState } from 'react';
import { getPreferences, updatePreferences } from '../services/api';

const SAVE_DELAY_MS = 1500;

export function useUserPreferences(accessToken) {
  const [preferences, setPreferences] = useState(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    getPreferences(accessToken)
      .then((data) => {
        if (!cancelled) setPreferences(data?.preferences ?? null);
      })
      .catch(() => {
        // preferences unavailable — dashboard uses defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const save = useCallback(
    (prefs) => {
      if (!accessToken) return;
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        updatePreferences(prefs, accessToken).catch(() => {
          // best-effort — silent failure
        });
      }, SAVE_DELAY_MS);
    },
    [accessToken],
  );

  return { preferences, loading, save };
}
