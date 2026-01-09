// hooks/useGastos.ts
//
// Hook de listado de gastos gestionables con:
// - Carga automática por filtro
// - Estado loading/error
// - Protección contra race conditions (respuestas antiguas no pisan las nuevas)
// - Protección contra setState tras unmount
//
// Nota:
// - Este hook asume que `filtro` es un string union (pendientes/activos/todos).
//   Si en algún momento fuese objeto, convendría memoizarlo arriba con useMemo.

import axios from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGastos, FiltroGastos, Gasto } from '../services/gastosApi';

type UseGastosResult = {
  gastos: Gasto[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

export function useGastos(filtro: FiltroGastos): UseGastosResult {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Evita setState si el componente se desmonta
  const isMountedRef = useRef(true);

  // Evita que una respuesta "antigua" pise a otra más reciente
  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchGastos(filtro);

      // Si llegó una respuesta vieja, la ignoramos
      if (seq !== requestSeqRef.current) return;
      if (!isMountedRef.current) return;

      setGastos(data);
    } catch (err: any) {
      if (seq !== requestSeqRef.current) return;
      if (!isMountedRef.current) return;

      if (axios.isAxiosError(err)) {
        console.error(
          'Error cargando gastos',
          err.message,
          err.response?.status,
          err.response?.config?.url
        );
        setError(
          `HTTP ${err.response?.status ?? ''} en ${err.response?.config?.url ?? ''}`.trim()
        );
      } else {
        console.error('Error cargando gastos (no Axios)', err);
        setError('Error inesperado cargando gastos');
      }
    } finally {
      if (seq !== requestSeqRef.current) return;
      if (!isMountedRef.current) return;
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => {
    isMountedRef.current = true;
    void load();

    return () => {
      isMountedRef.current = false;
    };
  }, [load]);

  return {
    gastos,
    loading,
    error,
    reload: load,
  };
}
