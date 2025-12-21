// mobile_app/services/ramasProveedoresApi.ts
import { api } from './api';

export interface RamaProveedor {
  id: string;
  nombre: string;
  descripcion?: string | null;
}

export async function listRamasProveedores(): Promise<RamaProveedor[]> {
  const resp = await api.get<RamaProveedor[]>('/api/v1/ramas/proveedores/');
  return resp.data;
}
