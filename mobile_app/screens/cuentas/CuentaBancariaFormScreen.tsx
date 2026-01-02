// mobile_app/screens/cuentas/CuentaBancariaFormScreen.tsx

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { commonFormStyles } from '../../components/forms/formStyles';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { colors } from '../../theme/colors';

import { createCuenta, updateCuenta, deleteCuenta, CuentaBancaria } from '../../services/cuentasApi';
import { listProveedores, Proveedor } from '../../services/proveedoresApi';
import { parseImporte } from '../../utils/format';

type Props = { navigation: any; route: any };
const NOOP = () => {};

export const CuentaBancariaFormScreen: React.FC<Props> = ({ navigation, route }) => {
  const styles = commonFormStyles;

  const mode: 'create' | 'edit' = route?.params?.mode ?? 'create';
  const editing: CuentaBancaria | undefined = route?.params?.item;
  const isEdit = mode === 'edit';

  const [referencia, setReferencia] = useState(editing?.referencia ?? '');
  const [liquidezInicialText, setLiquidezInicialText] = useState(
    String(editing?.liquidezInicial ?? '')
  );
  const [activo, setActivo] = useState<boolean>(editing?.activo ?? true);

  const [bancoId, setBancoId] = useState<string | null>(editing?.bancoId ?? null);
  const [bancos, setBancos] = useState<Proveedor[]>([]);
  const [bancoQuery, setBancoQuery] = useState('');

  // Rama de proveedores: BANCOS
  const BANCOS_RAMA_ID = 'BAN-TIPORAMAPROVEEDOR-8D1302BD';

  useEffect(() => {
    const loadBancos = async () => {
      try {
        const onlyBanks = await listProveedores({ rama_id: BANCOS_RAMA_ID });
        setBancos(onlyBanks ?? []);
      } catch (e) {
        console.error('[CuentaBancariaForm] Error cargando bancos', e);
        Alert.alert('Error', 'No se han podido cargar los bancos (proveedores).');
      }
    };
    void loadBancos();
  }, []);

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

  const bancosFiltrados = useMemo(() => {
    const term = bancoQuery.trim().toLowerCase();
    if (!term) return bancos.slice(0, 50);
    return bancos
      .filter((b: any) => String(b.nombre ?? '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [bancos, bancoQuery]);

  const handleSave = async () => {
    console.log('[CuentaBancariaForm] handleSave pressed', { mode, bancoId, referencia, liquidezInicialText, activo });

    const refFinal = referencia.trim().toUpperCase();
    if (!bancoId) return Alert.alert('Campo requerido', 'Debes seleccionar un banco.');
    if (!refFinal) return Alert.alert('Campo requerido', 'Debes indicar una referencia.');

    const parsed = parseImporte(liquidezInicialText || '0');
    if (parsed == null || isNaN(parsed)) return Alert.alert('Valor inválido', 'Liquidez inicial no válida.');
    if (parsed < 0) return Alert.alert('Valor inválido', 'Liquidez inicial no puede ser negativa.');

    try {
      if (isEdit && editing?.id) {
        console.log('[CuentaBancariaForm] updateCuenta payload ->', {
          banco_id: bancoId,
          referencia: refFinal,
          liquidez_inicial: parsed,
          activo,
        });

        await updateCuenta(editing.id, {
          banco_id: bancoId,
          referencia: refFinal,
          liquidez_inicial: parsed,
          activo,
        });

        Alert.alert('OK', 'Cuenta actualizada.');
        navigation.goBack();
        return;
      }

      console.log('[CuentaBancariaForm] createCuenta payload ->', {
        banco_id: bancoId,
        referencia: refFinal,
        liquidez_inicial: parsed,
        activo,
      });

      await createCuenta({
        banco_id: bancoId,
        referencia: refFinal,
        liquidez_inicial: parsed,
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
          <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
            <Ionicons name="save-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
            <Text style={styles.saveButtonText}>{isEdit ? 'Guardar cambios' : 'Guardar'}</Text>
          </TouchableOpacity>

          {isEdit ? (
            <TouchableOpacity
              style={{
                marginTop: 10,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.danger,
                paddingVertical: 14,
                borderRadius: 16,
              }}
              onPress={handleDelete}
            >
              <Ionicons name="trash-outline" size={18} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 15 }}>Eliminar</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    >
      <FormSection title="Datos">
        <View style={styles.field}>
          <InlineSearchSelect<Proveedor>
            label="Banco"
            onAddPress={NOOP}
            addAccessibilityLabel="Añadir (no aplica)"
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

        <View style={[styles.field, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <Text style={styles.label}>Activo</Text>
          <Switch value={activo} onValueChange={setActivo} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Anagrama (automático)</Text>
          <TextInput style={[styles.input, styles.inputFilled]} value={anagramaPreview} editable={false} />
          <Text style={styles.helperText}>Se calcula como "REFERENCIA - NOMBRE DEL BANCO".</Text>
        </View>
      </FormSection>
    </FormScreen>
  );
};
