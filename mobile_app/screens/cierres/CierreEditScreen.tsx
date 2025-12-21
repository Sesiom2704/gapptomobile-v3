// mobile_app/screens/cierres/CierreEditScreen.tsx
// -----------------------------------------------------------------------------
// Edición de cierre (solo editar, no crear).
// - Edita cabecera (criterio, liquidez_total, etc.)
// - Edita detalle por segmento (esperado/real) con PATCH por línea
// -----------------------------------------------------------------------------

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';

import Header from '../../components/layout/Header';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import formLayoutStyles from '../../components/forms/formLayoutStyles';
import { panelStyles } from '../../components/panels/panelStyles';
import { colors } from '../../theme/colors';

import { cierreMensualApi, CierreMensual, CierreMensualDetalle } from '../../services/cierreMensualApi';
import { EuroformatEuro, parseEuroToNumber } from '../../utils/format';

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function safeNumber(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export default function CierreEditScreen() {
  const styles = commonFormStyles;
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const cierreId: string = route.params?.cierreId;
  const cierreFromParams: CierreMensual | undefined = route.params?.cierre;

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [cierre, setCierre] = useState<CierreMensual | null>(cierreFromParams ?? null);
  const [detalles, setDetalles] = useState<CierreMensualDetalle[]>([]);

  // Campos editables (cabecera)
  const [criterio, setCriterio] = useState<string>(cierreFromParams?.criterio ?? 'CAJA');
  const [liquidezTxt, setLiquidezTxt] = useState<string>(
    cierreFromParams?.liquidez_total != null ? String(cierreFromParams.liquidez_total).replace('.', ',') : ''
  );

  const title = useMemo(() => {
    if (!cierre) return 'Editar cierre';
    return `Editar cierre ${cierre.anio}-${pad2(cierre.mes)}`;
  }, [cierre]);

  const load = useCallback(async () => {
    if (!cierreId) return;

    setLoading(true);
    try {
      // No tienes endpoint GET by id aún; aprovechamos:
      // - lista + find (simple)
      // - detalles por cierre
      const list = await cierreMensualApi.list();
      const found = (list || []).find((x) => x.id === cierreId) ?? null;
      setCierre(found);

      if (found) {
        setCriterio(found.criterio ?? 'CAJA');
        setLiquidezTxt(found.liquidez_total != null ? String(found.liquidez_total).replace('.', ',') : '');
      }

      const det = await cierreMensualApi.detalles(cierreId);
      setDetalles(Array.isArray(det) ? det : []);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo cargar el cierre.');
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cierreId, navigation]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const onSaveHeader = useCallback(async () => {
    if (!cierreId) return;

    const liquidez = parseEuroToNumber(liquidezTxt);
    if (liquidezTxt.trim() !== '' && liquidez == null) {
      Alert.alert('Valor inválido', 'Liquidez total no es un número válido.');
      return;
    }

    setSaving(true);
    try {
      const updated = await cierreMensualApi.update(cierreId, {
        criterio: (criterio || 'CAJA').trim(),
        liquidez_total: liquidez ?? 0,
      });
      setCierre(updated);
      Alert.alert('Guardado', 'Cabecera actualizada.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudo guardar la cabecera.');
    } finally {
      setSaving(false);
    }
  }, [cierreId, criterio, liquidezTxt]);

  const onSaveDetalle = useCallback(
    async (detalleId: string, patch: Partial<CierreMensualDetalle>) => {
      setSaving(true);
      try {
        const updated = await cierreMensualApi.updateDetalle(detalleId, patch);

        setDetalles((prev) =>
          prev.map((d) => (d.id === detalleId ? { ...d, ...updated } : d))
        );
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'No se pudo guardar el detalle.');
      } finally {
        setSaving(false);
      }
    },
    []
  );

  if (loading) {
    return (
      <>
        <Header title="Editar cierre" subtitle="Cargando..." showBack />
        <View style={[panelStyles.screen, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator />
        </View>
      </>
    );
  }

  return (
    <>
      <Header title={title} subtitle="Edición manual (cabecera y detalle)." showBack />

      <View style={panelStyles.screen}>
        <ScrollView
          contentContainerStyle={panelStyles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {/* CABECERA */}
          <FormSection title="Cabecera">
            <View style={styles.field}>
              <Text style={styles.label}>Criterio</Text>
              <TextInput
                value={criterio}
                onChangeText={setCriterio}
                style={[styles.input, criterio.trim() ? styles.inputFilled : null]}
                placeholder="CAJA"
                editable={!saving}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Liquidez total</Text>
              <TextInput
                value={liquidezTxt}
                onChangeText={setLiquidezTxt}
                style={[styles.input, liquidezTxt.trim() ? styles.inputFilled : null]}
                placeholder="0,00"
                keyboardType="decimal-pad"
                inputMode="decimal"
                editable={!saving}
              />
              <Text style={styles.helperText}>
                Vista: {EuroformatEuro(parseEuroToNumber(liquidezTxt) ?? 0, 'normal')}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.saveButton, saving ? { opacity: 0.7 } : null]}
              disabled={saving}
              onPress={onSaveHeader}
            >
              <Text style={styles.saveButtonText}>{saving ? 'Guardando...' : 'Guardar cabecera'}</Text>
            </TouchableOpacity>
          </FormSection>

          {/* DETALLE */}
          <FormSection title="Detalle por segmentos">
            {detalles.length === 0 ? (
              <View style={panelStyles.card}>
                <Text style={panelStyles.cardTitle}>Sin detalle</Text>
                <Text style={panelStyles.cardSubtitle}>Este cierre no tiene líneas de detalle.</Text>
              </View>
            ) : (
              detalles.map((d) => (
                <DetalleEditorRow
                  key={d.id}
                  item={d}
                  disabled={saving}
                  onSave={onSaveDetalle}
                />
              ))
            )}
          </FormSection>
        </ScrollView>
      </View>
    </>
  );
}

function DetalleEditorRow({
  item,
  disabled,
  onSave,
}: {
  item: CierreMensualDetalle;
  disabled: boolean;
  onSave: (detalleId: string, patch: Partial<CierreMensualDetalle>) => Promise<void>;
}) {
  const styles = commonFormStyles;

  const [espTxt, setEspTxt] = useState<string>(String(safeNumber(item.esperado)).replace('.', ','));
  const [realTxt, setRealTxt] = useState<string>(String(safeNumber(item.real)).replace('.', ','));

  const esperado = parseEuroToNumber(espTxt) ?? 0;
  const real = parseEuroToNumber(realTxt) ?? 0;
  const desviacion = esperado - real;

  const titulo = `${(item.tipo_detalle || '').toUpperCase()} · ${item.segmento_id || ''}`.trim();

  const onGuardar = async () => {
    const esp = parseEuroToNumber(espTxt);
    const rea = parseEuroToNumber(realTxt);

    if (espTxt.trim() !== '' && esp == null) {
      Alert.alert('Valor inválido', 'Esperado no es un número válido.');
      return;
    }
    if (realTxt.trim() !== '' && rea == null) {
      Alert.alert('Valor inválido', 'Real no es un número válido.');
      return;
    }

    await onSave(item.id, {
      esperado: esp ?? 0,
      real: rea ?? 0,
      // dejamos que backend recalcule desviación/cumplimiento si quieres,
      // pero enviarlo también mejora consistencia inmediata:
      desviacion: (esp ?? 0) - (rea ?? 0),
    });
  };

  return (
    <View style={[panelStyles.card, { marginBottom: 10 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={panelStyles.menuIconCircleSecondary}>
          <Ionicons name="layers-outline" size={20} color={colors.primary} />
        </View>
        <View style={{ marginLeft: 10, flex: 1 }}>
          <Text style={panelStyles.cardTitle}>{titulo || 'DETALLE'}</Text>
          <Text style={panelStyles.cardSubtitle}>Edición manual de importes.</Text>
        </View>
      </View>

      <View style={formLayoutStyles.row}>
        <View style={formLayoutStyles.col1of2}>
          <View style={styles.field}>
            <Text style={styles.label}>Esperado</Text>
            <TextInput
              value={espTxt}
              onChangeText={setEspTxt}
              style={[styles.input, espTxt.trim() ? styles.inputFilled : null]}
              keyboardType="decimal-pad"
              inputMode="decimal"
              editable={!disabled}
            />
            <Text style={styles.helperText}>Vista: {EuroformatEuro(esperado, 'minus')}</Text>
          </View>
        </View>

        <View style={formLayoutStyles.col1of2}>
          <View style={styles.field}>
            <Text style={styles.label}>Real</Text>
            <TextInput
              value={realTxt}
              onChangeText={setRealTxt}
              style={[styles.input, realTxt.trim() ? styles.inputFilled : null]}
              keyboardType="decimal-pad"
              inputMode="decimal"
              editable={!disabled}
            />
            <Text style={styles.helperText}>Vista: {EuroformatEuro(real, 'minus')}</Text>
          </View>
        </View>
      </View>

      <Text style={[panelStyles.cardSubtitle, { marginTop: 6, color: colors.textPrimary }]}>
        Desviación:{' '}
        <Text style={{ fontWeight: '900', color: desviacion > 0 ? colors.success : desviacion < 0 ? colors.danger : colors.warning }}>
          {EuroformatEuro(desviacion, 'signed')}
        </Text>
      </Text>

      <TouchableOpacity
        style={[styles.saveButton, disabled ? { opacity: 0.7 } : null, { marginTop: 10 }]}
        disabled={disabled}
        onPress={onGuardar}
      >
        <Text style={styles.saveButtonText}>{disabled ? 'Guardando...' : 'Guardar línea'}</Text>
      </TouchableOpacity>
    </View>
  );
}
