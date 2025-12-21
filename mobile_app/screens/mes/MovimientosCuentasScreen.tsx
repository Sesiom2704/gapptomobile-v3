/**
 * Archivo: screens/mes/MovimientosCuentasScreen.tsx
 *
 * Responsabilidad:
 *   - Pantalla de consulta de movimientos entre cuentas (transferencias) para un mes/año.
 *   - Opcionalmente filtra por una cuenta concreta (cuentaId) y muestra un resumen superior de entradas/salidas.
 *
 * Maneja:
 *   - UI: Header + ScrollView con pull-to-refresh; card de resumen (si hay cuentaId) y card de listado compacto.
 *   - Estado: local (useState) para movimientos, balance y flags de refreshing.
 *   - Datos:
 *       - Lectura: fetchMovimientosCuenta (movimientos), fetchBalanceMes (saldos por cuenta del mes).
 *   - Navegación:
 *       - Back estándar (navigation.goBack()).
 *
 * Entradas / Salidas:
 *   - route.params:
 *       - year: number
 *       - month: number
 *       - cuentaId: string | null (si viene, activa resumen por cuenta)
 *   - Efectos:
 *       - Carga paralela de movimientos + balance (Promise.all).
 *       - Cálculo de resumen por cuenta (useMemo): entradas, salidas e impacto neto.
 *       - Pull-to-refresh: recarga de datos.
 *
 * Dependencias clave:
 *   - UI interna: Header, panelStyles
 *   - Tema: colors
 *   - Utilidades: EuroformatEuro
 *
 * Reutilización:
 *   - Candidato a externalizar: ALTO (patrón de fila de listado: icono + texto + importe + detalles opcionales).
 *   - Riesgos: performance si el listado crece (ScrollView + map). Ideal migrar a FlatList si supera ~100-200 ítems.
 *
 * Notas de estilo:
 *   - Mantener consistencia de filas usando componentes base (p.ej. ListRow/IconCircle) para evitar duplicidad de estilos.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { ListRow } from '../../components/ui/ListRow';
import { IconCircle } from '../../components/ui/IconCircle';

import {
  fetchMovimientosCuenta,
  MovimientoCuentaListItem,
} from '../../services/movimientosCuentaApi';
import {
  fetchBalanceMes,
  BalanceMesResponse,
} from '../../services/balanceApi';
import { EuroformatEuro } from '../../utils/format';

type RouteParams = {
  year: number;
  month: number;
  cuentaId: string | null;
};

const MovimientosCuentasScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { year, month, cuentaId } = route.params as RouteParams;

  const [movimientos, setMovimientos] = useState<MovimientoCuentaListItem[]>(
    []
  );
  const [balance, setBalance] = useState<BalanceMesResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const tituloMes = `${String(month).padStart(2, '0')}/${year}`;

  // ------------------------------------------------------------
  // CARGA DE DATOS
  // ------------------------------------------------------------
  const loadData = useCallback(async () => {
    try {
      setRefreshing(true);

      const [movs, bal] = await Promise.all([
        fetchMovimientosCuenta({
          year,
          month,
          cuentaId: cuentaId ?? undefined, // 👈 aquí convertimos null -> undefined
          limit: 200,
        }),
        fetchBalanceMes({ year, month }),
      ]);

      setMovimientos(movs);
      setBalance(bal);
    } catch (err) {
      console.error(
        '[MovimientosCuentasScreen] Error al cargar datos',
        err
      );
    } finally {
      setRefreshing(false);
    }
  }, [year, month, cuentaId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    await loadData();
  };

  // ------------------------------------------------------------
  // RESUMEN SUPERIOR SI VIENE FILTRADO POR CUENTA
  // ------------------------------------------------------------
  const resumenCuenta = useMemo(() => {
    if (!balance || !cuentaId) return null;

    const cuenta = balance.saldos_cuentas.find(
      (c) => c.cuenta_id === cuentaId
    );
    if (!cuenta) return null;

    const nombreCuenta = cuenta.anagrama || cuenta.cuenta_id;

    let entradas = 0;
    let salidas = 0;

    // Como el backend ya filtra por cuenta_id (origen o destino),
    // cada movimiento afecta a esta cuenta en origen o en destino.
    movimientos.forEach((mov) => {
      if (mov.origenNombre === nombreCuenta) {
        // Esta cuenta es origen -> salida
        salidas += mov.importe;
      } else if (mov.destinoNombre === nombreCuenta) {
        // Esta cuenta es destino -> entrada
        entradas += mov.importe;
      }
    });

    return {
      nombreCuenta,
      entradas,
      salidas,
      impactoNeto: entradas - salidas,
    };
  }, [balance, cuentaId, movimientos]);

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <>
      <Header
        title="Movimientos entre cuentas"
        subtitle={tituloMes}
        showBack
        onBackPress={() => navigation.goBack()}
      />

      <View style={panelStyles.screen}>
        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          }
        >
          {/* RESUMEN DE LA CUENTA (solo si cuentaId != null) */}
          {cuentaId && resumenCuenta && (
            <View style={panelStyles.section}>
              <Text style={panelStyles.sectionTitle}>
                Resumen de la cuenta
              </Text>

              <View style={panelStyles.card}>
                <Text style={styles.resumenCuentaTitulo}>
                  {resumenCuenta.nombreCuenta}
                </Text>

                <View style={styles.resumenCuentaRow}>
                  <Text style={styles.resumenCuentaLabel}>
                    Entradas
                  </Text>
                  <Text style={styles.resumenCuentaPos}>
                    {EuroformatEuro(resumenCuenta.entradas, 'plus')}
                  </Text>
                </View>

                <View style={styles.resumenCuentaRow}>
                  <Text style={styles.resumenCuentaLabel}>
                    Salidas
                  </Text>
                  <Text style={styles.resumenCuentaNeg}>
                    {EuroformatEuro(resumenCuenta.salidas, 'minus')}
                  </Text>
                </View>

                <View style={styles.resumenCuentaRow}>
                  <Text style={styles.resumenCuentaLabel}>
                    Impacto neto
                  </Text>
                  <Text style={styles.resumenCuentaNet}>
                    {EuroformatEuro(
                      resumenCuenta.impactoNeto,
                      'signed'
                    )}
                  </Text>
                </View>
              </View>
            </View>
          )}

          {/* LISTADO COMPACTO DE MOVIMIENTOS */}
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Listado</Text>

            <View style={panelStyles.card}>
              {movimientos.map((mov) => {
                const saldoOrigenAntes = mov.saldoOrigenAntes ?? 0;
                const saldoOrigenDespues = mov.saldoOrigenDespues ?? 0;
                const saldoDestinoAntes = mov.saldoDestinoAntes ?? 0;
                const saldoDestinoDespues = mov.saldoDestinoDespues ?? 0;

                return (
                  <ListRow
                    key={mov.id}
                    left={
                      <IconCircle
                        name="swap-horizontal-outline"
                        diameter={30}
                        size={16}
                        backgroundColor={colors.primarySoft}
                        iconColor={colors.primary}
                        style={{ marginTop: 2 }}
                      />
                    }
                    title={`${mov.fecha} · ${mov.origenNombre} → ${mov.destinoNombre}`}
                    right={
                      <Text style={styles.movAmount}>
                        {EuroformatEuro(mov.importe, 'normal')}
                      </Text>
                    }
                    details={
                      <Text style={styles.movDetail}>
                        Origen:{' '}
                        <Text style={styles.neg}>{EuroformatEuro(saldoOrigenAntes, 'normal')}</Text> →{' '}
                        <Text style={styles.neg}>{EuroformatEuro(saldoOrigenDespues, 'normal')}</Text>
                        {' · '}Destino:{' '}
                        <Text style={styles.pos}>{EuroformatEuro(saldoDestinoAntes, 'normal')}</Text> →{' '}
                        <Text style={styles.pos}>{EuroformatEuro(saldoDestinoDespues, 'normal')}</Text>
                      </Text>
                    }
                    footer={
                      mov.comentarios ? (
                        <Text style={styles.movComment} numberOfLines={1} ellipsizeMode="tail">
                          Nota: {mov.comentarios}
                        </Text>
                      ) : null
                    }
                  />
                );
              })}

              {movimientos.length === 0 && !refreshing && (
                <Text style={styles.emptyText}>
                  No hay movimientos para este periodo.
                </Text>
              )}
            </View>
          </View>
        </ScrollView>
      </View>
    </>
  );
};

export default MovimientosCuentasScreen;

const styles = StyleSheet.create({
  // Resumen cuenta
  resumenCuentaTitulo: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 6,
  },
  resumenCuentaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  resumenCuentaLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  resumenCuentaPos: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
  },
  resumenCuentaNeg: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.danger,
  },
  resumenCuentaNet: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },

  // Fila movimiento
  movRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  movIconCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 4,
  },
  movContent: {
    flex: 1,
  },
  movTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  movMain: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    flexShrink: 1,
  },
  movAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginLeft: 8,
  },
  movDetail: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  movComment: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  pos: {
    color: colors.success,
  },
  neg: {
    color: colors.danger,
  },
  emptyText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
