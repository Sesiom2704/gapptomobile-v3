// hooks/useGastos.ts (ejemplo)
import axios from 'axios';
import { fetchGastos, FiltroGastos, Gasto } from '../services/gastosApi';
import { useEffect, useState } from 'react';

export function useGastos(filtro: FiltroGastos) {
  const [gastos, setGastos] = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGastos(filtro);
      setGastos(data);
    } catch (err: any) {
      if (axios.isAxiosError(err)) {
        console.error(
          'Error cargando gastos',
          err.message,
          err.response?.status,
          err.response?.config?.url
        );
        setError(
          `HTTP ${err.response?.status ?? ''} en ${
            err.response?.config?.url ?? ''
          }`
        );
      } else {
        console.error('Error cargando gastos (no Axios)', err);
        setError('Error inesperado cargando gastos');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filtro]);

  return {
    gastos,
    loading,
    error,
    reload: load,
  };
}
