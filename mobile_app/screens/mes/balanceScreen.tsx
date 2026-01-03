// screens/balance/BalanceScreen.tsx
/**
 * RESPONSABILIDAD (sin romper nada):
 * - Mostrar balance del mes, saldos por cuentas, pendientes, últimos movimientos y KPIs de liquidez.
 * - Permitir "Nuevo movimiento entre cuentas" (ahora en MODAL con overlay, cerrable tocando fuera).
 * - Permitir "Info/Ajuste liquidez" por cuenta (modal).
 *
 * CAMBIOS (requisitos):
 * 1) Al ajustar liquidez: en comentarios guardar "Ajuste de liquidez manual".
 * 2) En "Pendiente de cobro/pago":
 *    - Impacto Neto: si es negativo en rojo; si es positivo en verde (0 neutro).
 *    - Quitar el texto "(si se cobra todo y se ...)" y poner un botón de info a la derecha
 *      que al pulsar muestre ese mensaje (usando InfoModal global).
 * 3) "Nuevo movimiento entre cuentas":
 *    - Pasar a Modal con overlay. Si pulsas fuera del formulario, cierra igual que la "X".
 *
 * NOTAS:
 * - No se toca lógica de negocio (APIs, cálculos, navegación), salvo el comentario del ajuste (requisito 1).
 * - Se reutiliza InfoModal global ya existente para el botón de info del Impacto neto.
 */

// mobile_app/screens/mes/BalanceScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Alert,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';
import { AccountPill } from '../../components/ui/AccountPill';

import { EuroformatEuro } from '../../utils/format';

import {
  fetchBalanceMes,
  type BalanceMesResponse,
  type SaldoCuentaItem,
} from '../../services/balanceApi';

import {
  crearMovimientoCuenta,
  fetchMovimientosCuenta,
  ajustarLiquidezCuenta,
  type MovimientoCuentaListItem,
} from '../../services/movimientosCuentaApi';

// ✅ Info modal reutilizable
import { InfoButton, InfoModal, useInfoModal } from '../../components/ui/InfoModal';

const todayISO = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

type RouteParams = {
  returnToTab?: 'HomeTab' | 'DayToDayTab' | 'MonthTab' | 'PatrimonyTab';
  returnToScreen?: string;
};

const BalanceScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const { returnToTab, returnToScreen } = (route.params ?? {}) as RouteParams;

  const handleBack = useCallback(() => {
    if (returnToTab && returnToScreen) {
      navigation.navigate(returnToTab, { screen: returnToScreen });
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  }, [navigation, returnToTab, returnToScreen]);

  const now = useMemo(() => new Date(), []);
  const [year] = useState(now.getFullYear());
  const [month] = useState(now.getMonth() + 1);

  const [balance, setBalance] = useState<BalanceMesResponse | null>(null);
  const [movimientos, setMovimientos] = useState<MovimientoCuentaListItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // ✅ Info modal (único por pantalla)
  const info = useInfoModal();

  // -------------------------
  // Estado "Nuevo movimiento" (ahora modal)
  // -------------------------
  const [showTransferBox, setShowTransferBox] = useState(false);
  const [origenId, setOrigenId] = useState<string | null>(null);
  const [destinoId, setDestinoId] = useState<string | null>(null);
  const [importeMovimiento, setImporteMovimiento] = useState<string>('');
  const [comentariosMovimiento, setComentariosMovimiento] = useState<string>('');

  // -------------------------
  // Estado "Info / Ajuste liquidez"
  // -------------------------
  const [showAdjustBox, setShowAdjustBox] = useState(false);
  const [cuentaSeleccionadaId, setCuentaSeleccionadaId] = useState<string | null>(null);
  const [showNuevoSaldoInput, setShowNuevoSaldoInput] = useState(false);
  const [nuevoSaldo, setNuevoSaldo] = useState<string>('');

  const cuentas: SaldoCuentaItem[] = balance?.saldos_cuentas ?? [];

  const cuentaSeleccionada: SaldoCuentaItem | null =
    cuentas.find((c) => c.cuenta_id === cuentaSeleccionadaId) ?? null;

  const cuentaSeleccionadaSaldoFin = cuentaSeleccionada?.fin ?? 0;

  // Previsión por cuenta: saldo actual - gastos pendientes + ingresos pendientes
  const previsionCuentaSeleccionada =
    cuentaSeleccionada != null
      ? cuentaSeleccionada.fin -
        (cuentaSeleccionada.gastos_gestionables_pendientes +
          cuentaSeleccionada.gastos_cotidianos_pendientes) +
        cuentaSeleccionada.ingresos_pendientes
      : 0;

  // -------------------------
  // Datos derivados del balance
  // -------------------------
  const resumenMes = useMemo(() => {
    if (!balance) return null;

    const entradasTotales = cuentas.reduce((acc, c) => acc + (c.entradas ?? 0), 0);
    const salidasTotales = cuentas.reduce((acc, c) => acc + (c.salidas ?? 0), 0);
    const resultadoMes = entradasTotales - salidasTotales;

    return {
      liquidezActual: balance.liquidez_actual_total,
      liquidezInicio: balance.liquidez_inicio_mes_total,
      liquidezPrevista: balance.liquidez_prevista_total,
      ahorroMes: balance.ahorro_mes_total ?? 0,
      entradas: entradasTotales,
      salidas: salidasTotales,
      resultadoMes,
    };
  }, [balance, cuentas]);

  const ingresosPendientesTotal = balance?.ingresos_pendientes_total ?? 0;
  const gastosPendientesTotal = balance?.gastos_pendientes_total ?? 0;
  const impactoNetoPendiente = ingresosPendientesTotal - gastosPendientesTotal;

  /**
   * ✅ Requisito (2):
   * Color del Impacto Neto según signo:
   * - < 0: rojo (danger)
   * - > 0: verde (success)
   * - = 0: neutro (textPrimary)
   */
  const impactoNetoColor =
    impactoNetoPendiente < 0
      ? colors.danger
      : impactoNetoPendiente > 0
        ? colors.success
        : colors.textPrimary;

  const indicadoresLiquidez = useMemo(() => {
    if (!cuentas.length) {
      return { cuentasNegativas: 0, cuentasConPocoSaldo: 0, liquidezDisponible: 0 };
    }

    const cuentasNegativas = cuentas.filter((c) => c.fin < 0).length;
    const cuentasConPocoSaldo = cuentas.filter((c) => c.fin >= 0 && c.fin < 150).length;
    const liquidezDisponible = cuentas
      .filter((c) => c.fin > 0)
      .reduce((acc, c) => acc + c.fin, 0);

    return { cuentasNegativas, cuentasConPocoSaldo, liquidezDisponible };
  }, [cuentas]);

  // -------------------------
  // Carga de datos
  // -------------------------
  const loadData = useCallback(async () => {
    setRefreshing(true);
    try {
      const [balanceResp, movimientosResp] = await Promise.all([
        fetchBalanceMes({ year, month }),
        fetchMovimientosCuenta({ year, month, limit: 3 }),
      ]);

      setBalance(balanceResp);
      setMovimientos(movimientosResp);
    } catch (error) {
      console.error('[BalanceScreen] Error al cargar datos', error);
      Alert.alert('Error', 'No se han podido cargar los datos del balance. Inténtalo de nuevo.');
    } finally {
      setRefreshing(false);
    }
  }, [year, month]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = async () => {
    await loadData();
  };

  // -------------------------
  // Navegación a Movimientos de cuentas
  // -------------------------
  const handleVerMovimientos = (cuentaId?: string | null) => {
    navigation.navigate('MovimientosCuentasScreen', { year, month, cuentaId: cuentaId ?? null });
  };

  // -------------------------
  // Nuevo movimiento entre cuentas (Modal)
  // -------------------------
  const handleOpenTransfer = () => {
    setShowTransferBox((prev) => !prev);

    // Al abrir nuevo movimiento, ocultamos el panel de ajuste
    if (!showTransferBox) {
      setShowAdjustBox(false);
      setCuentaSeleccionadaId(null);
      setShowNuevoSaldoInput(false);
      setNuevoSaldo('');
    }
  };

  const handleCancelTransfer = () => {
    setShowTransferBox(false);
    setOrigenId(null);
    setDestinoId(null);
    setImporteMovimiento('');
    setComentariosMovimiento('');
  };

  const handleSaveTransfer = async () => {
    if (!origenId || !destinoId) {
      Alert.alert('Datos incompletos', 'Debes seleccionar cuenta de origen y destino.');
      return;
    }
    if (origenId === destinoId) {
      Alert.alert('Movimiento inválido', 'La cuenta de origen y la de destino no pueden ser la misma.');
      return;
    }
    if (!importeMovimiento.trim()) {
      Alert.alert('Datos incompletos', 'Debes indicar un importe.');
      return;
    }

    try {
      const fecha = todayISO();

      await crearMovimientoCuenta({
        fecha,
        cuentaOrigenId: origenId,
        cuentaDestinoId: destinoId,
        importe: importeMovimiento,
        comentarios: comentariosMovimiento || null,
      });

      Alert.alert('Movimiento guardado', 'Movimiento registrado correctamente.');
      handleCancelTransfer();
      await loadData();
    } catch (error) {
      console.error('[BalanceScreen] Error al guardar movimiento', error);
      Alert.alert('Error', 'No se ha podido guardar el movimiento. Revisa los datos e inténtalo de nuevo.');
    }
  };

  // -------------------------
  // Información / Ajuste liquidez
  // -------------------------
  const handleOpenAdjustFromRow = (cuentaId: string) => {
    setCuentaSeleccionadaId(cuentaId);
    setShowAdjustBox(true);
    setShowTransferBox(false);
    setShowNuevoSaldoInput(false);
    setNuevoSaldo('');
  };

  const handleCancelAdjust = () => {
    setShowAdjustBox(false);
    setCuentaSeleccionadaId(null);
    setShowNuevoSaldoInput(false);
    setNuevoSaldo('');
  };

  const handleSaveAdjust = async () => {
    if (!cuentaSeleccionadaId) {
      Alert.alert('Sin cuenta', 'Debes seleccionar una cuenta.');
      return;
    }
    if (!nuevoSaldo.trim()) {
      Alert.alert('Importe requerido', 'Debes indicar el nuevo saldo.');
      return;
    }

    try {
      const fecha = todayISO();

      await ajustarLiquidezCuenta({
        fecha,
        cuentaId: cuentaSeleccionadaId,
        nuevoSaldo,
        // ✅ Requisito (1): comentario “limpio” y consistente
        comentarios: 'Ajuste de liquidez manual',
      });

      Alert.alert('Saldo actualizado', 'Liquidez ajustada correctamente.');
      handleCancelAdjust();
      await loadData();
    } catch (error) {
      console.error('[BalanceScreen] Error al ajustar liquidez', error);
      Alert.alert('Error', 'No se ha podido ajustar la liquidez. Revisa los datos e inténtalo de nuevo.');
    }
  };

  // -------------------------
  // Render
  // -------------------------
  return (
    <>
      <Header
        title="Balance del mes"
        subtitleYear={year}
        subtitleMonth={month}
        subtitleMessage="Balance de cuentas y liquidez"
        showBack
        onBackPress={handleBack}
        onAddPress={handleOpenTransfer}
      />

      <View style={panelStyles.screen}>
        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {/* 🔹 Resumen del mes */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={panelStyles.sectionTitle}>Resumen del mes</Text>
              <InfoButton
                align="title"
                onPress={() =>
                  info.open(
                    'Resumen del mes',
                    'Liquidez total del mes: saldo actual, inicio, previsión fin de mes y ahorro. A la derecha: entradas, salidas y resultado neto.'
                  )
                }
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.resumenRowTop}>
                <View style={styles.resumenLeft}>
                  <Text style={panelStyles.cardTitle}>Liquidez actual</Text>
                  <Text style={styles.liquidezValue}>
                    {resumenMes ? EuroformatEuro(resumenMes.liquidezActual, 'normal') : '–'}
                  </Text>

                  <Text style={[panelStyles.cardSubtitle, styles.resumenSubtitleCompact]}>
                    Inicio de mes: {resumenMes ? EuroformatEuro(resumenMes.liquidezInicio, 'normal') : '–'}
                  </Text>
                  <Text style={[panelStyles.cardSubtitle, styles.resumenSubtitleCompact]}>
                    Prev. fin de mes: {resumenMes ? EuroformatEuro(resumenMes.liquidezPrevista, 'normal') : '–'}
                  </Text>
                  <Text style={[panelStyles.cardSubtitle, styles.resumenSubtitleCompact]}>
                    Ahorrado: {resumenMes ? EuroformatEuro(resumenMes.ahorroMes, 'plus') : '–'}
                  </Text>
                </View>

                <View style={styles.resumenRight}>
                  <View style={styles.chipRow}>
                    <View style={styles.chipPositive}>
                      <Ionicons name="arrow-down-circle-outline" size={14} color={colors.success} />
                      <Text style={styles.chipPositiveText}>
                        Entradas {resumenMes ? EuroformatEuro(resumenMes.entradas, 'plus') : '–'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.chipRow}>
                    <View style={styles.chipNegative}>
                      <Ionicons name="arrow-up-circle-outline" size={14} color={colors.danger} />
                      <Text style={styles.chipNegativeText}>
                        Salidas {resumenMes ? EuroformatEuro(resumenMes.salidas, 'minus') : '–'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.chipRow}>
                    <View style={styles.chipNeutral}>
                      <Ionicons name="speedometer-outline" size={14} color={colors.primary} />
                      <Text style={styles.chipNeutralText}>
                        Resultado {resumenMes ? EuroformatEuro(resumenMes.resultadoMes, 'signed') : '–'}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* 🔹 Saldo por cuentas */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={panelStyles.sectionTitle}>Saldo por cuentas</Text>
              <InfoButton
                align="title"
                onPress={() =>
                  info.open(
                    'Saldo por cuentas',
                    'Desglose por cuenta: inicio, entradas, salidas y saldo actual. Toca una fila para ver el detalle y ajustar liquidez si lo necesitas.'
                  )
                }
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableHeaderText, styles.tableHeaderCuenta, { flex: 2 }]}>Cuenta</Text>
                <Text style={styles.tableHeaderText}>Inicio</Text>
                <Text style={styles.tableHeaderText}>Entradas</Text>
                <Text style={styles.tableHeaderText}>Salidas</Text>
                <Text style={styles.tableHeaderText}>Actual</Text>
              </View>

              {cuentas.map((c) => (
                <TouchableOpacity
                  key={c.cuenta_id}
                  onPress={() => handleOpenAdjustFromRow(c.cuenta_id)}
                  activeOpacity={0.7}
                >
                  <View style={styles.tableRow}>
                    <Text style={[styles.tableCellCuenta, { flex: 2 }]}>{c.anagrama ?? c.cuenta_id}</Text>
                    <Text style={styles.tableCell}>{EuroformatEuro(c.inicio, 'normal')}</Text>
                    <Text style={styles.tableCell}>{EuroformatEuro(c.entradas, 'normal')}</Text>
                    <Text style={styles.tableCell}>{EuroformatEuro(c.salidas, 'normal')}</Text>
                    <Text style={styles.tableCell}>{EuroformatEuro(c.fin, 'normal')}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* 🔹 Pendiente de cobro/pago */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={panelStyles.sectionTitle}>Pendiente de cobro/pago</Text>
              <InfoButton
                align="title"
                onPress={() =>
                  info.open(
                    'Pendiente de cobro/pago',
                    'Ingresos pendientes: cobros no recibidos. Gastos pendientes: pagos aún no cargados. Impacto neto: efecto estimado si se cobrara y pagara todo.'
                  )
                }
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.pendientesRow}>
                <View style={styles.pendienteCol}>
                  <Text style={panelStyles.cardTitle}>Ingresos pendientes</Text>
                  <Text style={styles.pendientePositiveValue}>
                    {EuroformatEuro(ingresosPendientesTotal, 'plus')}
                  </Text>
                  <Text style={panelStyles.cardSubtitle}>Nóminas, alquileres y otros cobros no recibidos.</Text>
                </View>

                <View style={styles.pendienteCol}>
                  <Text style={panelStyles.cardTitle}>Gastos pendientes</Text>
                  <Text style={styles.pendienteNegativeValue}>
                    {EuroformatEuro(gastosPendientesTotal, 'minus')}
                  </Text>
                  <Text style={panelStyles.cardSubtitle}>Recibos, préstamos y cargos aún no cobrados.</Text>
                </View>
              </View>

              {/* ✅ Requisito (2): color por signo + info button a la derecha */}
              <View style={styles.pendienteResumenRow}>
                <Text style={styles.pendienteResumenLabel}>Impacto neto</Text>

                <View style={styles.pendienteResumenRight}>
                  <Text style={[styles.pendienteResumenValue, { color: impactoNetoColor }]}>
                    {EuroformatEuro(impactoNetoPendiente, 'signed')}
                  </Text>

                  {/* Botón de info alineado a la derecha (muestra el mensaje solicitado) */}
                  <TouchableOpacity
                    style={styles.pendienteInfoButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={() => info.open('Impacto neto', 'Si se cobra todo y se pagan todos')}
                  >
                    <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* 🔹 Últimos movimientos */}
          <View style={panelStyles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={panelStyles.sectionTitle}>Últimos movimientos de cuentas</Text>
              <InfoButton
                align="title"
                onPress={() =>
                  info.open(
                    'Últimos movimientos de cuentas',
                    'Últimos traspasos registrados entre cuentas durante el mes. Puedes abrir el listado completo desde el botón inferior.'
                  )
                }
              />
            </View>

            <View style={panelStyles.card}>
              {movimientos.map((mov) => (
                <View key={mov.id} style={styles.movRow}>
                  <View style={styles.movIconCircle}>
                    <Ionicons name="swap-horizontal-outline" size={16} color={colors.primary} />
                  </View>

                  <View style={styles.movTextContainer}>
                    <Text style={styles.movTitle}>
                      {mov.origenNombre} → {mov.destinoNombre}
                    </Text>
                    <Text style={styles.movSubtitle}>
                      {mov.fecha} · {mov.comentarios || 'Sin comentarios'}
                    </Text>
                  </View>

                  <Text style={styles.movAmount}>{EuroformatEuro(mov.importe, 'signed')}</Text>
                </View>
              ))}

              <TouchableOpacity style={panelStyles.cardButton} onPress={() => handleVerMovimientos(null)}>
                <Text style={panelStyles.cardButtonText}>Ver todos los movimientos</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 🔹 Indicadores */}
          <View style={[panelStyles.section, { marginBottom: 24 }]}>
            <View style={styles.sectionHeaderRow}>
              <Text style={panelStyles.sectionTitle}>Indicadores de liquidez</Text>
              <InfoButton
                align="title"
                onPress={() =>
                  info.open(
                    'Indicadores de liquidez',
                    'Alertas rápidas: número de cuentas en negativo, cuentas con poco saldo y liquidez disponible (suma de saldos positivos).'
                  )
                }
              />
            </View>

            <View style={panelStyles.card}>
              <View style={styles.indicatorRow}>
                <View style={styles.indicatorIconCircle}>
                  <Ionicons name="warning-outline" size={18} color={colors.danger} />
                </View>
                <View style={styles.indicatorTextContainer}>
                  <Text style={styles.indicatorTitle}>Cuentas en negativo</Text>
                  <Text style={styles.indicatorSubtitle}>
                    {indicadoresLiquidez.cuentasNegativas} cuenta(s) con saldo negativo.
                  </Text>
                </View>
              </View>

              <View style={styles.indicatorRow}>
                <View style={styles.indicatorIconCircle}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                </View>
                <View style={styles.indicatorTextContainer}>
                  <Text style={styles.indicatorTitle}>Cuentas con poco saldo</Text>
                  <Text style={styles.indicatorSubtitle}>
                    {indicadoresLiquidez.cuentasConPocoSaldo} cuenta(s) por debajo de 150 €.
                  </Text>
                </View>
              </View>

              <View style={styles.indicatorRow}>
                <View style={styles.indicatorIconCircle}>
                  <Ionicons name="wallet-outline" size={18} color={colors.primary} />
                </View>
                <View style={styles.indicatorTextContainer}>
                  <Text style={styles.indicatorTitle}>Liquidez disponible</Text>
                  <Text style={styles.indicatorSubtitle}>
                    {EuroformatEuro(indicadoresLiquidez.liquidezDisponible, 'normal')} entre todas las cuentas con saldo
                    positivo.
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        {/* =========================================
            ✅ Requisito (3): Modal "Nuevo movimiento"
            - Tocar fuera cierra igual que la X
            - Misma UI y validaciones de antes
           ========================================= */}
        <Modal
          visible={showTransferBox}
          transparent
          animationType="fade"
          onRequestClose={handleCancelTransfer}
        >
          {/* Overlay: cualquier toque fuera del formulario cancela */}
          <TouchableWithoutFeedback onPress={handleCancelTransfer}>
            <View style={styles.transferOverlay}>
              {/* Contenedor interno: evita que el toque “atraviese” y cierre */}
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.transferModalCardWrapper}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.transferModalScrollContent}
                  >
                    <View style={panelStyles.section}>
                      <View style={styles.sectionTitleRow}>
                        <View style={styles.titleWithInfo}>
                          <Text style={panelStyles.sectionTitle}>Nuevo movimiento entre cuentas</Text>
                          <InfoButton
                            align="title"
                            onPress={() =>
                              info.open(
                                'Nuevo movimiento entre cuentas',
                                'Registra un traspaso entre dos cuentas (origen y destino). El movimiento se guarda dentro del mes.'
                              )
                            }
                          />
                        </View>

                        <TouchableOpacity
                          style={styles.sectionTitleCloseButton}
                          onPress={handleCancelTransfer}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>

                      <View style={panelStyles.card}>
                        {/* Cuenta origen */}
                        <View style={styles.transferField}>
                          <Text style={styles.transferLabel}>Cuenta origen</Text>
                          <View style={styles.accountsRow}>
                            {cuentas.map((cta) => {
                              const bloqueada = destinoId === cta.cuenta_id;

                              return (
                                <View
                                  key={cta.cuenta_id}
                                  style={[styles.accountPillWrapper, bloqueada && { opacity: 0.3 }]}
                                >
                                  <AccountPill
                                    label={cta.anagrama ?? cta.cuenta_id}
                                    subLabel={EuroformatEuro(cta.fin, 'normal')}
                                    selected={origenId === cta.cuenta_id}
                                    onPress={() => {
                                      if (bloqueada) return;
                                      setOrigenId(cta.cuenta_id);
                                    }}
                                    size="small"
                                  />
                                </View>
                              );
                            })}
                          </View>
                        </View>

                        {/* Cuenta destino */}
                        <View style={styles.transferField}>
                          <Text style={styles.transferLabel}>Cuenta destino</Text>
                          <View style={styles.accountsRow}>
                            {cuentas.map((cta) => {
                              const bloqueada = origenId === cta.cuenta_id;

                              return (
                                <View
                                  key={cta.cuenta_id}
                                  style={[styles.accountPillWrapper, bloqueada && { opacity: 0.3 }]}
                                >
                                  <AccountPill
                                    label={cta.anagrama ?? cta.cuenta_id}
                                    subLabel={EuroformatEuro(cta.fin, 'normal')}
                                    selected={destinoId === cta.cuenta_id}
                                    onPress={() => {
                                      if (bloqueada) return;
                                      setDestinoId(cta.cuenta_id);
                                    }}
                                    size="small"
                                  />
                                </View>
                              );
                            })}
                          </View>
                        </View>

                        {/* Importe */}
                        <View style={styles.transferField}>
                          <Text style={styles.transferLabel}>Importe</Text>
                          <TextInput
                            style={styles.transferInput}
                            keyboardType="decimal-pad"
                            placeholder="Ej. 200,00"
                            value={importeMovimiento}
                            onChangeText={setImporteMovimiento}
                          />
                        </View>

                        {/* Comentarios */}
                        <View style={styles.transferField}>
                          <Text style={styles.transferLabel}>Comentarios (opcional)</Text>
                          <TextInput
                            style={[styles.transferInput, styles.transferInputMultiline]}
                            placeholder="Ej. Traspaso mensual al ahorro"
                            value={comentariosMovimiento}
                            onChangeText={setComentariosMovimiento}
                            multiline
                          />
                        </View>

                        {/* Guardar */}
                        <View style={styles.transferButtonsRow}>
                          <TouchableOpacity style={styles.transferSaveButton} onPress={handleSaveTransfer}>
                            <Ionicons name="swap-horizontal-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                            <Text style={styles.transferSaveButtonText}>Guardar movimiento</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* Modal de ajuste */}
        <Modal
          visible={showAdjustBox && !!cuentaSeleccionada}
          transparent
          animationType="fade"
          onRequestClose={handleCancelAdjust}
        >
          <TouchableWithoutFeedback onPress={handleCancelAdjust}>
            <View style={styles.adjustOverlay}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.adjustModalCardWrapper}>
                  <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.adjustModalScrollContent}>
                    <View style={panelStyles.card}>
                      <View style={styles.cardHeaderRow}>
                        <TouchableOpacity
                          style={styles.closeIconButton}
                          onPress={handleCancelAdjust}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="close" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>

                      <View style={styles.transferField}>
                        <Text style={styles.transferLabel}>Cuenta</Text>
                        <View style={styles.cuentaSeleccionadaBox}>
                          <Ionicons name="wallet-outline" size={18} color={colors.primary} style={{ marginRight: 6 }} />
                          <Text style={styles.cuentaSeleccionadaText}>
                            {cuentaSeleccionada?.anagrama ?? cuentaSeleccionada?.cuenta_id}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.transferField}>
                        <View style={styles.adjustRow}>
                          <View style={styles.adjustSaldoCol}>
                            <Text style={styles.adjustSaldoLabel}>Saldo actual</Text>
                            <Text style={styles.adjustSaldoValue}>
                              {EuroformatEuro(cuentaSeleccionadaSaldoFin, 'normal')}
                            </Text>
                          </View>

                          <View style={styles.adjustSaldoCol}>
                            <TouchableOpacity
                              style={styles.botonNuevoSaldo}
                              onPress={() => setShowNuevoSaldoInput((prev) => !prev)}
                            >
                              <Ionicons
                                name={showNuevoSaldoInput ? 'close' : 'create-outline'}
                                size={16}
                                color="#fff"
                                style={{ marginRight: 6 }}
                              />
                              <Text style={styles.botonNuevoSaldoText}>
                                {showNuevoSaldoInput ? 'Cancelar' : 'Nuevo saldo'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>

                      <View style={styles.transferField}>
                        <Text style={styles.transferLabel}>Pendiente en esta cuenta</Text>

                        <View style={styles.pendientesCuentaList}>
                          <View style={styles.pendientesCuentaRow}>
                            <Text style={styles.pendientesCuentaLabel}>Gest. pendientes</Text>
                            <Text style={styles.pendientesCuentaValueNeg}>
                              {EuroformatEuro(cuentaSeleccionada?.gastos_gestionables_pendientes ?? 0, 'minus')}
                            </Text>
                          </View>
                          <View style={styles.pendientesCuentaRow}>
                            <Text style={styles.pendientesCuentaLabel}>Cotid. pendientes</Text>
                            <Text style={styles.pendientesCuentaValueNeg}>
                              {EuroformatEuro(cuentaSeleccionada?.gastos_cotidianos_pendientes ?? 0, 'minus')}
                            </Text>
                          </View>
                          <View style={styles.pendientesCuentaRow}>
                            <Text style={styles.pendientesCuentaLabel}>Ing. pendientes</Text>
                            <Text style={styles.pendientesCuentaValuePos}>
                              {EuroformatEuro(cuentaSeleccionada?.ingresos_pendientes ?? 0, 'plus')}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={{ marginBottom: 12 }}>
                        <Text style={[panelStyles.cardSubtitle, { marginTop: 2 }]}>
                          Previsión en esta cuenta:{' '}
                          <Text style={{ fontWeight: '700', color: colors.textPrimary }}>
                            {EuroformatEuro(previsionCuentaSeleccionada, 'signed')}
                          </Text>
                        </Text>
                      </View>

                      {showNuevoSaldoInput && (
                        <>
                          <View style={styles.transferField}>
                            <Text style={styles.adjustSaldoLabel}>Nuevo saldo</Text>
                            <TextInput
                              style={styles.adjustSaldoInput}
                              keyboardType="decimal-pad"
                              placeholder="Ej. 2.500,00"
                              value={nuevoSaldo}
                              onChangeText={setNuevoSaldo}
                            />
                          </View>

                          <View style={styles.adjustButtonsRow}>
                            <TouchableOpacity
                              style={styles.transferCancelButton}
                              onPress={() => {
                                setShowNuevoSaldoInput(false);
                                setNuevoSaldo('');
                              }}
                            >
                              <Text style={styles.transferCancelButtonText}>Cancelar</Text>
                            </TouchableOpacity>

                            <TouchableOpacity style={styles.transferSaveButton} onPress={handleSaveAdjust}>
                              <Ionicons name="save-outline" size={16} color="#fff" style={{ marginRight: 6 }} />
                              <Text style={styles.transferSaveButtonText}>Guardar saldo</Text>
                            </TouchableOpacity>
                          </View>
                        </>
                      )}
                    </View>
                  </ScrollView>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* ✅ Modal global de info */}
        <InfoModal visible={info.visible} title={info.title} text={info.text} onClose={info.close} />
      </View>
    </>
  );
};

export default BalanceScreen;

const styles = StyleSheet.create({
  // Header por sección: título a la izquierda, "i" al final a la derecha
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleWithInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitleCloseButton: {
    padding: 4,
    marginTop: 0,
  },

  resumenRowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  resumenLeft: { flex: 1, paddingRight: 8 },
  resumenRight: { flex: 1, paddingLeft: 8 },
  liquidezValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.primary,
    marginTop: 4,
    marginBottom: 2,
  },
  resumenSubtitleCompact: {
    marginTop: 0,
    marginBottom: 0,
    fontSize: 11,
    lineHeight: 14,
  },

  chipRow: { marginBottom: 4 },
  chipPositive: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e6f8ec',
  },
  chipPositiveText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.success,
  },
  chipNegative: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#fde9e9',
  },
  chipNegativeText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.danger,
  },
  chipNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#e4ecff',
  },
  chipNeutralText: {
    marginLeft: 4,
    fontSize: 11,
    fontWeight: '600',
    color: colors.primary,
  },

  tableHeaderRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'right',
  },
  tableHeaderCuenta: { textAlign: 'left' },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tableCellCuenta: {
    fontSize: 9,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'left',
  },
  tableCell: {
    flex: 1,
    fontSize: 11,
    textAlign: 'right',
    color: colors.textSecondary,
  },

  pendientesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  pendienteCol: { flex: 1 },
  pendientePositiveValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.success,
    marginTop: 4,
    marginBottom: 2,
  },
  pendienteNegativeValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.danger,
    marginTop: 4,
    marginBottom: 2,
  },

  /**
   * ✅ “Impacto neto”: ahora el valor y el botón de info comparten “lado derecho”.
   * Mantiene diseño compacto, y el icono queda visualmente alineado a la derecha.
   */
  pendienteResumenRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pendienteResumenLabel: { fontSize: 11, color: colors.textSecondary },
  pendienteResumenRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendienteResumenValue: { fontSize: 12, fontWeight: '600' },
  pendienteInfoButton: {
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  indicatorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  indicatorIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  indicatorTextContainer: { flex: 1 },
  indicatorTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  indicatorSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },

  transferField: { marginBottom: 12 },
  transferLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
  transferInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  transferInputMultiline: { minHeight: 60, textAlignVertical: 'top' },

  transferButtonsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  transferCancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  transferCancelButtonText: { fontSize: 12, color: colors.textSecondary },
  transferSaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  transferSaveButtonText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  cardHeaderRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  closeIconButton: { padding: 4 },

  adjustRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adjustSaldoCol: { flex: 1 },
  cuentaSeleccionadaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  cuentaSeleccionadaText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  adjustSaldoLabel: { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  adjustSaldoValue: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  adjustSaldoInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  adjustButtonsRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  botonNuevoSaldo: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
  botonNuevoSaldoText: { fontSize: 12, fontWeight: '600', color: '#fff' },

  // -------------------------
  // Overlay Modal Ajuste
  // -------------------------
  adjustOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  adjustModalCardWrapper: { width: '100%', maxWidth: 420 },
  adjustModalScrollContent: { flexGrow: 0 },

  // -------------------------
  // Overlay Modal Transfer (requisito 3)
  // -------------------------
  transferOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  transferModalCardWrapper: { width: '100%', maxWidth: 520 },
  transferModalScrollContent: { flexGrow: 0 },

  movRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  movIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  movTextContainer: { flex: 1 },
  movTitle: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  movSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  movAmount: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginLeft: 8 },

  accountsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  accountPillWrapper: { width: '48%', marginBottom: 6 },

  pendientesCuentaList: { marginTop: 4 },
  pendientesCuentaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  pendientesCuentaLabel: { fontSize: 11, color: colors.textSecondary },
  pendientesCuentaValueNeg: { fontSize: 12, fontWeight: '600', color: colors.danger },
  pendientesCuentaValuePos: { fontSize: 12, fontWeight: '600', color: colors.success },
});
