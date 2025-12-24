// mobile_app/hooks/useHomeDashboard.ts
// -----------------------------------------------------------------------------
// Objetivo del cambio:
// - Mantener el hook tal cual.
// - Solo garantizar que el tipado HomeDashboardResponse (ampliado) fluye sin romper.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchHomeDashboard, HomeDashboardResponse } from '../services/homeDashboardApi';

export function useHomeDashboard() {
  const now = useMemo(() => new Date(), []);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const [data, setData] = useState<HomeDashboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchHomeDashboard({ year, month });
      setData(resp);
    } catch (e) {
      setError('No se ha podido cargar el panel principal.');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  return { year, month, data, loading, refreshing, error, refresh };
}
