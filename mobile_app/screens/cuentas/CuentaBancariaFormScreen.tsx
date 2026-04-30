/**
 * Ruta: mobile_app/screens/cuentas/CuentaBancariaFormScreen.tsx
 * Versión: 2.2.0
 * Descripción:
 * Formulario de creación y edición de cuentas bancarias.
 *
 * Responsabilidades:
 * - Crear y editar cuentas bancarias.
 * - Seleccionar banco desde proveedores filtrados por rama BANCOS.
 * - Permitir alta encadenada de proveedor banco desde el botón "+".
 * - Recuperar el proveedor creado y dejarlo seleccionado automáticamente.
 * - Mostrar botón de relaciones cuando exista associatedCount > 0.
 * - Renderizar el detalle de relaciones solo si realmente existe relationCounts.
 * - Permitir informar participación de cuenta.
 *
 * Regla de participación:
 * - 100 = cuenta propia completa.
 * - 50 = cuenta compartida al 50%.
 * - Este valor solo afecta a métricas de liquidez/patrimonio, no a movimientos reales.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { colors, spacing, radius } from '../../theme';

import {
  createCuenta,
  updateCuenta,
  deleteCuenta,
  CuentaBancaria,
} from '../../services/cuentasApi';
import { listProveedores, Proveedor } from '../../services/proveedoresApi';
import { parseImporte } from '../../utils/format';

type Props = { navigation: any; route: any };

type RelationCountItem = {
  key: string;
  label: string;
  count: number;
};

function parsePercentText(raw: string): number | null {
  const cleaned = String(raw ?? '').replace('%', '').replace(',', '.').trim();

  if (!cleaned) return null;

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return parsed;
}

export const CuentaBancariaFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const mode: 'create' | 'edit' = route?.params?.mode ?? 'create';
  const editing: CuentaBancaria | undefined = route?.params?.item;
  const isEdit = mode === 'edit';

  const [showRelations, setShowRelations] = useState(false);

  const [referencia, setReferencia] = useState(editing?.referencia ?? '');
  const [liquidezInicialText, setLiquidezInicialText] = useState(
    String(editing?.liquidezInicial ?? '')
  );
  const [participacionPctText, setParticipacionPctText] = useState(
    String(editing?.participacionPct ?? 100)
  );
  const [activo, setActivo] = useState<boolean>(editing?.activo ?? true);

  const [bancoId, setBancoId] = useState<string | null>(editing?.bancoId ?? null);
  const [bancos, setBancos] = useState<Proveedor[]>([]);
  const [bancoQuery, setBancoQuery] = useState('');

  const BANCOS_RAMA_ID = 'BAN-TIPORAMAPROVEEDOR-8D1302BD';

  const relationItems = useMemo<RelationCountItem[]>(() => {
    const raw = Array.isArray((editing as any)?.relationCounts)
      ? ((editing as any).relationCounts as RelationCountItem[])
      : Array.isArray((editing as any)?.relation_counts)
        ? ((editing as any).relation_counts as RelationCountItem[])
        : [];

    return raw.filter((rel) => Number(rel?.count ?? 0) > 0);
  }, [editing]);

  const associatedCount = useMemo<number>(() => {
    if (relationItems.length > 0) {
      return relationItems.reduce((acc, item) => acc + Number(item.count ?? 0), 0);
    }

    return Number(
      (editing as any)?.associatedCount ??
        (editing as any)?.associated_count ??
        0
    );
  }, [editing, relationItems]);

  const hasRelationsInfo = isEdit && associatedCount > 0;
  const hasRelationDetail = relationItems.length > 0;

  const loadBancos = async () => {
    try {
      const onlyBanks = await listProveedores({ rama_id: BANCOS_RAMA_ID });
      setBancos(onlyBanks ?? []);
    } catch (e) {
      console.error('[CuentaBancariaForm] Error cargando bancos', e);
      Alert.alert('Error', 'No se han podido cargar los bancos (proveedores).');
    }
  };

  useEffect(() => {
    void loadBancos();
  }, []);

  useEffect(() => {
    const auxResult = route?.params?.auxResult;
    if (!auxResult) return;

    try {
      navigation.setParams?.({ auxResult: undefined });
    } catch {
      // noop
    }

    if (auxResult?.type === 'proveedor' && auxResult?.item) {
      const nuevoBanco = auxResult.item as Proveedor;

      setBancos((prev) => {
        const exists = prev.some((x) => String(x.id) === String(nuevoBanco.id));
        if (exists) {
          return prev.map((x) => (String(x.id) === String(nuevoBanco.id) ? nuevoBanco : x));
        }
        return [nuevoBanco, ...prev];
      });

      setBancoId(String(nuevoBanco.id));
      setBancoQuery('');
    }
  }, [route?.params?.auxResult, navigation]);

  const bancoSelected = useMemo(() => {
    if (!bancoId) return null;
    return bancos.find((b: any) => String(b.id) === String(bancoId)) ?? null;
  }, [bancoId, bancos]);

  const anagramaPreview = useMemo(() => {
    const ref = (referencia ?? '').trim().toUpperCase();
    const bankName = String(bancoSelected?.nombre ?? '').trim().toUpperCase();

    if (!ref && !bankName) return '';
    if (!ref) return bankName;
    if (!bankName) return ref;
    return `${ref} - ${bankName}`;
  }, [referencia, bancoSelected?.nombre]);

  const liquidezPonderadaPreview = useMemo(() => {
    const liquidez = parseImporte(liquidezInicialText || '0');
    const pct = parsePercentText(participacionPctText);

    if (liquidez == null || Number.isNaN(liquidez)) return null;
    if (pct == null || Number.isNaN(pct)) return null;

    return liquidez * (pct / 100);
  }, [liquidezInicialText, participacionPctText]);

  const bancosFiltrados = useMemo(() => {
    const term = bancoQuery.trim().toLowerCase();
    if (!term) return bancos.slice(0, 50);

    return bancos
      .filter((b: any) => String(b.nombre ?? '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [bancos, bancoQuery]);

  const handleAddBancoProveedor = () => {
    navigation.push('AuxEntityForm', {
      auxType: 'proveedor',
      origin: 'config',
      returnRouteKey: route?.key,
      defaultRamaId: BANCOS_RAMA_ID,
    });
  };

  const handleSave = async () => {
    console.log('[CuentaBancariaForm] handleSave pressed', {
      mode,
      bancoId,
      referencia,
      liquidezInicialText,
      participacionPctText,
      activo,
    });

    const refFinal = referencia.trim().toUpperCase();

    if (!bancoId) {
      Alert.alert('Campo requerido', 'Debes seleccionar un banco.');
      return;
    }

    if (!refFinal) {
      Alert.alert('Campo requerido', 'Debes indicar una referencia.');
      return;
    }

    const parsedLiquidez = parseImporte(liquidezInicialText || '0');
    if (parsedLiquidez == null || isNaN(parsedLiquidez)) {
      Alert.alert('Valor inválido', 'Liquidez inicial no válida.');
      return;
    }

    if (parsedLiquidez < 0) {
      Alert.alert('Valor inválido', 'Liquidez inicial no puede ser negativa.');
      return;
    }

    const parsedParticipacion = parsePercentText(participacionPctText);
    if (parsedParticipacion == null || isNaN(parsedParticipacion)) {
      Alert.alert('Valor inválido', 'Participación no válida. Ejemplo: 100 o 50.');
      return;
    }

    if (parsedParticipacion <= 0 || parsedParticipacion > 100) {
      Alert.alert('Valor inválido', 'La participación debe estar entre 0,01% y 100%.');
      return;
    }

    try {
      if (isEdit && editing?.id) {
        console.log('[CuentaBancariaForm] updateCuenta payload ->', {
          banco_id: bancoId,
          referencia: refFinal,
          liquidez_inicial: parsedLiquidez,
          participacion_pct: parsedParticipacion,
          activo,
        });

        await updateCuenta(editing.id, {
          banco_id: bancoId,
          referencia: refFinal,
          liquidez_inicial: parsedLiquidez,
          participacion_pct: parsedParticipacion,
          activo,
        });

        Alert.alert('OK', 'Cuenta actualizada.');
        navigation.goBack();
        return;
      }

      console.log('[CuentaBancariaForm] createCuenta payload ->', {
        banco_id: bancoId,
        referencia: refFinal,
        liquidez_inicial: parsedLiquidez,
        participacion_pct: parsedParticipacion,
        activo,
      });

      await createCuenta({
        banco_id: bancoId,
        referencia: refFinal,
        liquidez_inicial: parsedLiquidez,
        participacion_pct: parsedParticipacion,
        activo,
      });

      Alert.alert('OK', 'Cuenta creada.');
      navigation.goBack();
    } catch (e: any) {
      console.error('[CuentaBancariaForm] Error guardando', e?.response?.data ?? e);
      Alert.alert('Error', 'No se ha podido guardar la cuenta.');
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !editing?.id) return;

    Alert.alert('Eliminar cuenta', '¿Seguro que quieres eliminar esta cuenta?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCuenta(editing.id);
            Alert.alert('OK', 'Cuenta eliminada.');
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', 'No se ha podido eliminar la cuenta.');
          }
        },
      },
    ]);
  };

  return (
    <FormScreen
      title={isEdit ? 'Editar cuenta' : 'Nueva cuenta'}
      onBackPress={() => navigation.goBack()}
      loading={false}
      footer={
        <View style={styles.bottomActions}>
          {hasRelationsInfo ? (
            <TouchableOpacity
              style={ui.relationsButton}
              onPress={() => setShowRelations((prev) => !prev)}
            >
              <Ionicons
                name={showRelations ? 'layers' : 'layers-outline'}
                size={18}
                color={colors.textPrimary}
                style={{ marginRight: 8 }}
              />
              <Text style={ui.relationsButtonText}>
                {showRelations ? 'Ocultar relaciones' : `Relaciones (${associatedCount})`}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Ionicons name="save-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>{isEdit ? 'Guardar cambios' : 'Guardar'}</Text>
          </TouchableOpacity>

          {isEdit ? (
            <TouchableOpacity style={ui.deleteButton} onPress={handleDelete}>
              <Ionicons
                name="trash-outline"
                size={18}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
              <Text style={ui.deleteButtonText}>Eliminar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    >
      <FormSection title="Datos">
        <View style={styles.field}>
          <InlineSearchSelect<Proveedor>
            label="Banco"
            onAddPress={handleAddBancoProveedor}
            addAccessibilityLabel="Crear banco"
            disabled={false}
            selected={bancoSelected as any}
            selectedLabel={(p: any) => (p?.nombre ?? '').toUpperCase()}
            onClear={() => setBancoId(null)}
            query={bancoQuery}
            onChangeQuery={setBancoQuery}
            placeholder="Escribe para buscar banco"
            options={bancosFiltrados}
            optionKey={(p: any) => String(p.id)}
            optionLabel={(p: any) => String(p.nombre ?? '').toUpperCase()}
            onSelect={(p: any) => {
              setBancoId(String(p.id));
              setBancoQuery('');
            }}
            emptyText="No hay bancos que coincidan."
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Referencia</Text>
          <TextInput
            style={[styles.input, referencia.trim() !== '' ? styles.inputFilled : null]}
            placeholder="Ej: NOMINA"
            value={referencia}
            onChangeText={(v) => setReferencia(v.toUpperCase())}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Liquidez inicial</Text>
          <TextInput
            style={[styles.input, liquidezInicialText.trim() !== '' ? styles.inputFilled : null]}
            placeholder="Ej: 0,00"
            value={liquidezInicialText}
            onChangeText={setLiquidezInicialText}
            keyboardType="decimal-pad"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Participación (%)</Text>
          <TextInput
            style={[styles.input, participacionPctText.trim() !== '' ? styles.inputFilled : null]}
            placeholder="Ej: 100 o 50"
            value={participacionPctText}
            onChangeText={setParticipacionPctText}
            keyboardType="decimal-pad"
          />
          <Text style={styles.helperText}>
            100% si la cuenta es solo tuya. 50% si la cuenta es compartida a medias.
          </Text>
        </View>

        {liquidezPonderadaPreview != null ? (
          <View style={ui.previewBox}>
            <Text style={ui.previewLabel}>Liquidez computable en Home</Text>
            <Text style={ui.previewValue}>
              {liquidezPonderadaPreview.toFixed(2).replace('.', ',')} €
            </Text>
            <Text style={ui.previewHelp}>
              Este cálculo solo afecta a métricas. Los movimientos reales siguen usando el 100%.
            </Text>
          </View>
        ) : null}

        <View
          style={[
            styles.field,
            { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
          ]}
        >
          <Text style={styles.label}>Activo</Text>
          <Switch value={activo} onValueChange={setActivo} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Anagrama (automático)</Text>
          <TextInput
            style={[styles.input, styles.inputFilled]}
            value={anagramaPreview}
            editable={false}
          />
          <Text style={styles.helperText}>
            Se calcula como "REFERENCIA - NOMBRE DEL BANCO".
          </Text>
        </View>
      </FormSection>

      {hasRelationsInfo && showRelations && hasRelationDetail ? (
        <FormSection title={`Relaciones (${associatedCount} registros)`}>
          {relationItems.map((rel) => (
            <View key={rel.key} style={ui.relationRow}>
              <View style={{ flex: 1 }}>
                <Text style={ui.relationLabel}>{rel.label}</Text>
                <Text style={ui.relationKey}>{rel.key}</Text>
              </View>

              <View style={ui.relationCountBadge}>
                <Text style={ui.relationCountText}>{rel.count}</Text>
              </View>
            </View>
          ))}
        </FormSection>
      ) : null}
    </FormScreen>
  );
};

export default CuentaBancariaFormScreen;

const ui = StyleSheet.create({
  relationsButton: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface ?? '#FFFFFF',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
  },
  relationsButtonText: {
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 15,
  },
  previewBox: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.primarySoft,
  },
  previewLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  previewValue: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  previewHelp: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textSecondary,
  },
  relationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  relationLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  relationKey: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  relationCountBadge: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relationCountText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  deleteButton: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    paddingVertical: 14,
    borderRadius: 16,
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 15,
  },
});