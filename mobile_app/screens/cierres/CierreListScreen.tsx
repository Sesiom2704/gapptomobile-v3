// mobile_app/screens/cierres/CierreListScreen.tsx
// -----------------------------------------------------------------------------
// Pantalla listado de cierres.
// - Lista cierres existentes (no obliga a generar).
// - Muestra importes en layout 2 columnas (label/value).
// - Desviación coloreada: + verde, - rojo, 0 naranja.
// - Menú "..." con Editar/Eliminar.
// - Tap en tarjeta -> CierreDetalleScreen.
// -----------------------------------------------------------------------------

// mobile_app/screens/cierres/CierreListScreen.tsx

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { cierreMensualApi, CierreMensual } from '../../services/cierreMensualApi';
import { EuroformatEuro } from '../../utils/format';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function getDeviationColor(value: number) {
  if (value > 0) return colors.success;
  if (value < 0) return colors.danger;
  return colors.warning;
}

const CierreListScreen: React.FC = () => {
  const navigation = useNavigation<any>();

  const [loading, setLoading] = useState<boolean>(false);
  const [cierres, setCierres] = useState<CierreMensual[]>([]);

  // Menú 3 puntos
  const [menuVisible, setMenuVisible] = useState(false);
  const [selected, setSelected] = useState<CierreMensual | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cierreMensualApi.list();
      setCierres(Array.isArray(data) ? data : []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los cierres.');
    } finally {
      setLoading(false);
    }
  }, []);

  const goMasKpis = useCallback(() => {
    navigation.navigate('CierreKpiScreen');
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const openMenu = useCallback((item: CierreMensual) => {
    setSelected(item);
    setMenuVisible(true);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuVisible(false);
    setSelected(null);
  }, []);

  const onDelete = useCallback(async () => {
    if (!selected) return;

    const cierreId = selected.id;
    const periodo = `${selected.anio}-${pad2(selected.mes)}`;

    closeMenu();

    Alert.alert(
      'Eliminar cierre',
      `Vas a eliminar el cierre ${periodo}. Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await cierreMensualApi.delete(cierreId);
              await load();
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'No se pudo eliminar el cierre.');
            }
          },
        },
      ]
    );
  }, [selected, closeMenu, load]);

  const onEdit = useCallback(() => {
    const item = selected;
    closeMenu();
    if (!item) return;

    navigation.navigate('CierreEditScreen', { cierreId: item.id, cierre: item });

  }, [selected, closeMenu]);

  const onOpenDetalle = useCallback(
    (item: CierreMensual) => {
      navigation.navigate('CierreDetalleScreen', { cierreId: item.id, cierre: item });
    },
    [navigation]
  );

  const emptyState = useMemo(() => {
    if (loading) return null;

    return (
      <View style={panelStyles.card}>
        <Text style={[panelStyles.cardTitle, { marginBottom: 6 }]}>Sin cierres todavía</Text>
        <Text style={panelStyles.cardSubtitle}>
          Aquí aparecerán los cierres mensuales cuando existan.
        </Text>
      </View>
    );
  }, [loading]);

  return (
    <>
    <Header
    title="Cierres mensuales"
    subtitle="Listado histórico y acceso a detalle."
    showBack
    rightIconName="eye-outline"
    onRightPress={goMasKpis}
    />

      <View style={panelStyles.screen}>
        <ScrollView contentContainerStyle={panelStyles.scrollContent}>
          <View style={panelStyles.section}>
            <Text style={panelStyles.sectionTitle}>Histórico</Text>

            {loading && (
              <View style={{ paddingVertical: 14 }}>
                <ActivityIndicator />
              </View>
            )}

            {!loading && cierres.length === 0 && emptyState}

            {cierres.map((c) => {
              const periodo = `${c.anio}-${pad2(c.mes)}`;

              const ingresosReal = Number(c.ingresos_reales || 0);
              const gastosReal = Number(c.gastos_reales_total || 0);
              const resultadoReal = Number(c.resultado_real || 0);
              const resultadoEsp = Number(c.resultado_esperado || 0);

              const desv = Number(c.desv_resultado ?? (resultadoReal - resultadoEsp));
              const desvColor = getDeviationColor(desv);

              return (
                <TouchableOpacity
                  key={c.id}
                  style={panelStyles.menuCard}
                  activeOpacity={0.85}
                  onPress={() => onOpenDetalle(c)}
                >
                  <View style={panelStyles.menuIconCircleSecondary}>
                    <Ionicons name="calendar-outline" size={22} color={colors.primary} />
                  </View>

                  <View style={panelStyles.menuTextContainer}>
                    {/* Título */}
                    <Text style={panelStyles.menuTitle}>
                      {periodo} · {c.criterio || 'CAJA'}
                    </Text>

                    {/* --------- SOLO 2 FILAS --------- */}
                    <View style={{ marginTop: 8 }}>
                      {/* Fila 1: Ingresos (+) | Gastos (-) */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={panelStyles.menuSubtitle}>
                          Ingresos:{" "}
                          <Text style={{ fontWeight: '800', color: colors.textPrimary }}>
                            {EuroformatEuro(ingresosReal, 'plus')}
                          </Text>
                        </Text>

                        <Text style={panelStyles.menuSubtitle}>
                          Gastos:{" "}
                          <Text style={{ fontWeight: '800', color: colors.textPrimary }}>
                            {EuroformatEuro(gastosReal, 'minus')}
                          </Text>
                        </Text>
                      </View>

                      {/* Fila 2: Resultado | Desviación (color) */}
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginTop: 4,
                        }}
                      >
                        <Text style={panelStyles.menuSubtitle}>
                          Resultado:{" "}
                          <Text style={{ fontWeight: '900', color: colors.textPrimary }}>
                            {EuroformatEuro(resultadoReal, 'signed')}
                          </Text>
                        </Text>

                        <Text style={panelStyles.menuSubtitle}>
                          Desv:{" "}
                          <Text style={{ fontWeight: '900', color: desvColor }}>
                            {EuroformatEuro(desv, 'signed')}
                          </Text>
                        </Text>
                      </View>
                    </View>
                    {/* -------------------------------- */}
                  </View>

                  {/* Acciones (3 puntos) */}
                  <TouchableOpacity
                    onPress={() => openMenu(c)}
                    style={{ paddingHorizontal: 6, paddingVertical: 6 }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Menú 3 puntos */}
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable
          onPress={closeMenu}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.35)',
            justifyContent: 'flex-end',
          }}
        >
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: colors.surface,
              padding: 14,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
            }}
          >
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 10, color: colors.textPrimary }}>
              Acciones
            </Text>

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}
              onPress={onEdit}
            >
              <Ionicons name="create-outline" size={20} color={colors.actionWarning} />
              <Text style={{ marginLeft: 10, fontWeight: '700', color: colors.textPrimary }}>
                Editar
              </Text>
            </TouchableOpacity>

            <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.08)' }} />

            <TouchableOpacity
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12 }}
              onPress={onDelete}
            >
              <Ionicons name="trash-outline" size={20} color={colors.actionDanger} />
              <Text style={{ marginLeft: 10, fontWeight: '800', color: colors.actionDanger }}>
                Eliminar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 8, paddingVertical: 12, alignItems: 'center' }}
              onPress={closeMenu}
            >
              <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

export default CierreListScreen;
