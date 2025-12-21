// constants/gastosCotidianos.ts

// ⚠️ Rellena este ID con el segmento REAL de "GASTOS COTIDIANOS" de tu tabla TIPO_SEGMENTO_GASTO
export const SEGMENTO_COTIDIANO_ID = 'SEG-COTIDIANO-RELLENAR';


export const TIPO_GASOLINA_ID = 'TIP-GASOLINA-SW1ZQO'; // 👉 pon aquí el ID REAL de GASOLINA

// Tipos de gasto que se consideran "cotidianos"
export const TIPOS_COTIDIANO = [
  { label: 'COMIDA', value: 'COM-TIPOGASTO-311A33BD' },
  { label: 'RESTAURANTES', value: 'RES-TIPOGASTO-26ROES' },
  { label: 'HOTELES', value: 'HOT-TIPOGASTO-357FDG' },
  { label: 'ACTIVIDADES', value: 'ACT-TIPOGASTO-2X9H1Q' },
  { label: 'TRANSPORTE', value: 'TRA-TIPOGASTO-RB133Z' },
  { label: 'GASOLINA', value: 'TIP-GASOLINA-SW1ZQO' },
  { label: 'PEAJES', value: 'PEA-TIPOGASTO-7HDY89' },
  { label: 'MANTENIMIENTO', value: 'MAV-TIPOGASTO-BVC356' },
  { label: 'ELECTRICIDAD', value: 'ELE-TIPOGASTO-47CC77E5' },
  { label: 'ROPA', value: 'ROP-TIPOGASTO-S227BB' },
] as const;

// tipo_gasto.id -> tipo_ramas_proveedores.id (para filtrar proveedores)
export const RAMA_POR_TIPO: Record<string, string> = {
  'COM-TIPOGASTO-311A33BD': 'SUP-TIPORAMAPROVEEDOR-E7CC022C',
  'ELE-TIPOGASTO-47CC77E5': 'SUM-TIPORAMAPROVEEDOR-20B9C505',
  'TIP-GASOLINA-SW1ZQO': 'GAS-TIPO_RAMA_PROVEEDOR-PFEBEC',
  'ROP-TIPOGASTO-S227BB': 'ROP-TIPO_RAMA_PROVEEDOR-S227BB',
  'RES-TIPOGASTO-26ROES': 'RES-TIPO_RAMA_PROVEEDOR-Y3FEC7',
  'TRA-TIPOGASTO-RB133Z': 'TRAN-TIPO_RAMA_PROVEEDOR-Y3FEC7',
  'HOT-TIPOGASTO-357FDG': 'HOT-TIPO_RAMA_PROVEEDOR-Y3FEC7',
  'PEA-TIPOGASTO-7HDY89': 'PEA-TIPORAMAPROVEEDOR-VH7PG8',
  'MAV-TIPOGASTO-BVC356': 'TAL-TIPORAMAPROVEEDOR-B0HT3K',
  'ACT-TIPOGASTO-2X9H1Q': 'ACT-TIPO_RAMA_PROVEEDOR-Y3FEC7',
};

// Evento predefinido (solo para RESTAURANTES)
export const EVENTO_OPTIONS = [
  { label: 'FAMILIA', value: 'FAMILIA' },
  { label: 'AMIGOS', value: 'AMIGOS' },
  { label: 'FAMILIA DE', value: 'FAMILIA DE' },
  { label: 'AMIGOS DE', value: 'AMIGOS DE' },
  { label: 'ROMÁNTICO', value: 'ROMANTICO' },
  { label: 'LABORAL', value: 'LABORAL' },
] as const;

// ID concreto del tipo RESTAURANTES
export const TIPO_RESTAURANTES_ID = 'RES-TIPOGASTO-26ROES';

// constants/gastosCotidianos.ts

