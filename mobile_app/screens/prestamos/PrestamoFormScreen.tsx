/**
 * Archivo: mobile_app/screens/prestamos/PrestamoFormScreen.tsx
 *
 * Responsabilidad:
 *   - Alta/edición de préstamo manteniendo comportamiento V2.
 *   - Usar componentes comunes del repo (FormScreen, FormSection, DateFieldButton, InlineSearchSelect, FormActionButton).
 *
 * Maneja:
 *   - UI: FormScreen, FormSection, TextInput, DateFieldButton, InlineSearchSelect, FormActionButton
 *   - Estado: local (campos + loading/refreshing)
 *   - Datos:
 *       - Lectura: prestamosApi.get(id), catálogos vía prestamosApi.catalogs()
 *       - Escritura: prestamosApi.create / prestamosApi.update
 *   - Navegación:
 *       - goBack al guardar/cancelar
 *
 * Entradas / Salidas:
 *   - route.params:
 *       - prestamoId?: string
 *   - Efectos:
 *       - carga inicial de catálogos + (si edición) datos del préstamo
 *
 * Dependencias clave:
 *   - UI interna: FormScreen, FormSection, InlineSearchSelect, DateFieldButton, FormActionButton
 *   - Tema: colors, spacing
 *
 * Reutilización:
 *   - Candidato a externalizar: MEDIO (patrón de form con catálogos).
 *   - Riesgos: si los catálogos se obtienen desde endpoints distintos en tu V3.
 *
 * Notas de estilo:
 *   - Corrige errores TS: tipoInteres, props de FormScreen, imports de DateFieldButton/FormActionButton.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';

import { FormScreen } from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { DateFieldButton } from '../../components/ui/DateFieldButton';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { colors, spacing } from '../../theme';

import { prestamosApi } from '../../services/prestamosApi';

type RouteParams = { prestamoId?: string };

type Proveedor = { id: string; nombre: string };
type Cuenta = { id: string; anagrama: string; banco_id?: string | null };
type Vivienda = { id: string; referencia: string; direccion_completa?: string | null };

type Periodicidad = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
type TipoInteres = 'FIJO' | 'VARIABLE' | 'MIXTO';

const PERIODS: Periodicidad[] = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const TIPOS_INTERES: TipoInteres[] = ['FIJO', 'VARIABLE', 'MIXTO'];

function fmtDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}
function isoDate(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${yyyy}-${mm}-${dd}`;
}

export default function PrestamoFormScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { prestamoId } = (route.params ?? {}) as RouteParams;
  const isEdit = !!prestamoId;

  const [loading, setLoading] = useState(true);

  // Catálogos
  const [bancos, setBancos] = useState<Proveedor[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  // Queries InlineSearchSelect
  const [qBanco, setQBanco] = useState('');
  const [qCuenta, setQCuenta] = useState('');

  // Form fields
  const [clasificacion, setClasificacion] = useState<'PERSONAL' | 'HIPOTECA'>('PERSONAL');
  const [nombre, setNombre] = useState('');

  const [banco, setBanco] = useState<Proveedor | null>(null);
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [vivienda, setVivienda] = useState<Vivienda | null>(null);

  const [fechaInicio, setFechaInicio] = useState<Date>(new Date());
  const [showDate, setShowDate] = useState(false);

  const [periodicidad, setPeriodicidad] = useState<Periodicidad>('MENSUAL');
  const [plazoMeses, setPlazoMeses] = useState('120');
  const [principal, setPrincipal] = useState('');

  const [tipoInteres, setTipoInteres] = useState<TipoInteres>('FIJO');
  const [tin, setTin] = useState('3.00');
  const [tae, setTae] = useState('');
  const [indice, setIndice] = useState('');
  const [diferencial, setDiferencial] = useState('');

  const [comApertura, setComApertura] = useState('0');
  const [otrosIni, setOtrosIni] = useState('0');

  const [activo, setActivo] = useState(true);

  const cuentasFiltradas = useMemo(() => {
    const base = cuentas;
    if (!banco?.id) return base;
    return base.filter((c) => String(c.banco_id ?? '') === String(banco.id));
  }, [cuentas, banco]);

  const bancosFilteredByQuery = useMemo(() => {
    const qq = qBanco.trim().toUpperCase();
    if (!qq) return bancos;
    return bancos.filter((b) => String(b.nombre ?? '').toUpperCase().includes(qq));
  }, [bancos, qBanco]);

  const cuentasFilteredByQuery = useMemo(() => {
    const base = cuentasFiltradas;
    const qq = qCuenta.trim().toUpperCase();
    if (!qq) return base;
    return base.filter((c) => String(c.anagrama ?? '').toUpperCase().includes(qq));
  }, [cuentasFiltradas, qCuenta]);

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      // Este endpoint es una abstracción: si en tu repo lo separas (proveedores/cuentas/patrimonios),
      // tu prestamosApi puede resolverlo internamente sin cambiar el screen.
      const catalogs = await prestamosApi.catalogs();
      setBancos(Array.isArray(catalogs?.bancos) ? catalogs.bancos : []);
      setCuentas(Array.isArray(catalogs?.cuentas) ? catalogs.cuentas : []);
      setViviendas(Array.isArray(catalogs?.viviendas) ? catalogs.viviendas : []);

      if (isEdit && prestamoId) {
        const p = await prestamosApi.get(prestamoId);

        setNombre(String(p?.nombre ?? ''));
        setClasificacion(p?.referencia_vivienda_id ? 'HIPOTECA' : 'PERSONAL');

        const bancoFound = (catalogs?.bancos ?? []).find((x: any) => String(x.id) === String(p?.proveedor_id));
        setBanco(bancoFound ?? null);

        const cuentaFound = (catalogs?.cuentas ?? []).find((x: any) => String(x.id) === String(p?.cuenta_id));
        setCuenta(cuentaFound ?? null);

        const vivFound = (catalogs?.viviendas ?? []).find(
          (x: any) => String(x.id) === String(p?.referencia_vivienda_id)
        );
        setVivienda(vivFound ?? null);

        setFechaInicio(p?.fecha_inicio ? new Date(String(p.fecha_inicio)) : new Date());
        setPeriodicidad((String(p?.periodicidad ?? 'MENSUAL').toUpperCase() as any) ?? 'MENSUAL');
        setPlazoMeses(String(p?.plazo_meses ?? '120'));
        setPrincipal(String(p?.importe_principal ?? ''));

        setTipoInteres((String(p?.tipo_interes ?? 'FIJO').toUpperCase() as any) ?? 'FIJO');
        setTin(String(p?.tin_pct ?? ''));
        setTae(p?.tae_pct != null ? String(p.tae_pct) : '');
        setIndice(String(p?.indice ?? ''));
        setDiferencial(p?.diferencial_pct != null ? String(p.diferencial_pct) : '');

        setComApertura(String(p?.comision_apertura ?? '0'));
        setOtrosIni(String(p?.otros_gastos_iniciales ?? '0'));

        setActivo(Boolean(p?.activo ?? true));
      }
    } catch {
      Alert.alert('Error', 'No se pudo cargar el formulario de préstamo.');
    } finally {
      setLoading(false);
    }
  }, [isEdit, prestamoId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const onSave = useCallback(async () => {
    if (!nombre.trim()) return Alert.alert('Atención', 'Indica un nombre.');
    if (!banco?.id) return Alert.alert('Atención', 'Selecciona un banco.');
    if (!cuenta?.id) return Alert.alert('Atención', 'Selecciona una cuenta.');

    if (clasificacion === 'HIPOTECA' && !vivienda?.id) {
      return Alert.alert('Atención', 'Selecciona una vivienda.');
    }

    const plazo = parseInt(plazoMeses || '0', 10);
    const principalNum = Number(String(principal).replace(',', '.')) || 0;
    const tinNum = Number(String(tin).replace(',', '.')) || 0;

    if (plazo <= 0) return Alert.alert('Atención', 'Plazo inválido.');
    if (principalNum <= 0) return Alert.alert('Atención', 'Principal debe ser > 0.');

    const payload: any = {
      nombre: nombre.trim().toUpperCase(),
      proveedor_id: banco.id,
      cuenta_id: cuenta.id,
      referencia_vivienda_id: clasificacion === 'HIPOTECA' ? vivienda?.id ?? null : null,

      fecha_inicio: isoDate(fechaInicio),
      periodicidad,
      plazo_meses: plazo,
      importe_principal: principalNum,

      tipo_interes: tipoInteres, // ✅ antes estaba mal referenciado
      tin_pct: tinNum,
      tae_pct: tae ? Number(String(tae).replace(',', '.')) : null,
      indice: tipoInteres === 'FIJO' ? null : (indice || null),
      diferencial_pct: tipoInteres === 'FIJO' ? null : (diferencial ? Number(String(diferencial).replace(',', '.')) : null),

      comision_apertura: Number(String(comApertura).replace(',', '.')) || 0,
      otros_gastos_iniciales: Number(String(otrosIni).replace(',', '.')) || 0,

      activo: isEdit ? activo : true,
      clasificacion,
    };

    try {
      if (isEdit && prestamoId) {
        await prestamosApi.update(prestamoId, payload);
      } else {
        await prestamosApi.create(payload);
      }
      navigation.goBack();
    } catch (e: any) {
      const msg = e?.response?.data?.detail ?? 'Error al guardar el préstamo.';
      Alert.alert('Error', String(msg));
    }
  }, [
    nombre,
    banco,
    cuenta,
    clasificacion,
    vivienda,
    fechaInicio,
    periodicidad,
    plazoMeses,
    principal,
    tipoInteres,
    tin,
    tae,
    indice,
    diferencial,
    comApertura,
    otrosIni,
    activo,
    isEdit,
    prestamoId,
    navigation,
  ]);

  const title = isEdit ? 'Editar préstamo' : 'Nuevo préstamo';
  const subtitle = isEdit ? 'Edición' : 'Alta';

  return (
    <FormScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      onBackPress={() => navigation.goBack()}
        footer={
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }}>
              <FormActionButton
                label="Cancelar"
                variant="secondary"
                onPress={() => navigation.goBack()}
              />
            </View>

            <View style={{ width: spacing.sm }} />

            <View style={{ flex: 1 }}>
              <FormActionButton
                label={isEdit ? 'Actualizar' : 'Guardar'}
                variant="primary"
                onPress={onSave}
              />
            </View>
          </View>
        }
    >
      <FormSection title="Datos básicos">
        <View style={styles.toggleRow}>
          <FormActionButton
            label="PERSONAL"
            variant={clasificacion === 'PERSONAL' ? 'primary' : 'secondary'}
            onPress={() => setClasificacion('PERSONAL')}
            style={{ flex: 1 }}
          />
          <View style={{ width: spacing.sm }} />
          <FormActionButton
            label="HIPOTECA"
            variant={clasificacion === 'HIPOTECA' ? 'primary' : 'secondary'}
            onPress={() => setClasificacion('HIPOTECA')}
            style={{ flex: 1 }}
          />
        </View>

        <Text style={styles.label}>Nombre</Text>
        <TextInput
          value={nombre}
          onChangeText={setNombre}
          placeholder="Ej. HIPOTECA PISO CENTRO"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </FormSection>

      <FormSection title="Banco y cuenta">
        <InlineSearchSelect<Proveedor>
          label="Banco"
          onAddPress={() => {}}
          disabled={false}
          selected={banco}
          selectedLabel={(x) => x.nombre}
          onClear={() => {
            setBanco(null);
            setCuenta(null);
            setQBanco('');
            setQCuenta('');
          }}
          query={qBanco}
          onChangeQuery={setQBanco}
          placeholder="Buscar banco…"
          options={bancosFilteredByQuery}
          optionKey={(x) => x.id}
          optionLabel={(x) => x.nombre}
          onSelect={(x) => {
            setBanco(x);
            setCuenta(null);
            setQBanco('');
            setQCuenta('');
          }}
          emptyText="Sin resultados"
        />

        <InlineSearchSelect<Cuenta>
          label="Cuenta"
          onAddPress={() => {}}
          disabled={!banco}
          selected={cuenta}
          selectedLabel={(x) => x.anagrama}
          onClear={() => {
            setCuenta(null);
            setQCuenta('');
          }}
          query={qCuenta}
          onChangeQuery={setQCuenta}
          placeholder={banco ? 'Buscar cuenta…' : 'Selecciona banco primero'}
          options={cuentasFilteredByQuery}
          optionKey={(x) => x.id}
          optionLabel={(x) => x.anagrama}
          onSelect={(x) => {
            setCuenta(x);
            setQCuenta('');
          }}
          emptyText="Sin resultados"
        />

        {clasificacion === 'HIPOTECA' ? (
          <>
            <Text style={styles.label}>Vivienda</Text>
            <View style={styles.simpleList}>
              {viviendas.map((v) => {
                const selected = vivienda?.id === v.id;
                return (
                  <FormActionButton
                    key={v.id}
                    label={v.direccion_completa ? `${v.referencia} · ${v.direccion_completa}` : v.referencia}
                    variant={selected ? 'primary' : 'secondary'}
                    onPress={() => setVivienda(selected ? null : v)}
                    style={{ marginBottom: spacing.xs }}
                  />
                );
              })}
            </View>
          </>
        ) : null}
      </FormSection>

      <FormSection title="Condiciones">
        <Text style={styles.label}>Fecha inicio</Text>
        <DateFieldButton text={fmtDate(fechaInicio)} onPress={() => setShowDate(true)} />
        {showDate ? (
          <DateTimePicker
            value={fechaInicio}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'calendar'}
            onChange={(_, d) => {
              setShowDate(false);
              if (d) setFechaInicio(d);
            }}
          />
        ) : null}

        <Text style={styles.label}>Periodicidad</Text>
        <View style={styles.toggleRow}>
          {PERIODS.map((p) => (
            <FormActionButton
              key={p}
              label={p}
              variant={periodicidad === p ? 'primary' : 'secondary'}
              onPress={() => setPeriodicidad(p)}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        <Text style={styles.label}>Plazo (meses)</Text>
        <TextInput
          value={plazoMeses}
          onChangeText={setPlazoMeses}
          keyboardType="numeric"
          placeholder="Ej. 120"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        <Text style={styles.label}>Principal (€)</Text>
        <TextInput
          value={principal}
          onChangeText={setPrincipal}
          keyboardType="decimal-pad"
          placeholder="Ej. 150000"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        <Text style={styles.label}>Tipo de interés</Text>
        <View style={styles.toggleRow}>
          {TIPOS_INTERES.map((t) => (
            <FormActionButton
              key={t}
              label={t}
              variant={tipoInteres === t ? 'primary' : 'secondary'}
              onPress={() => setTipoInteres(t)}
              style={{ flex: 1 }}
            />
          ))}
        </View>

        <Text style={styles.label}>TIN (%)</Text>
        <TextInput
          value={tin}
          onChangeText={setTin}
          keyboardType="decimal-pad"
          placeholder="Ej. 3.10"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        <Text style={styles.label}>TAE (%)</Text>
        <TextInput
          value={tae}
          onChangeText={setTae}
          keyboardType="decimal-pad"
          placeholder="Opcional"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        {tipoInteres !== 'FIJO' ? (
          <>
            <Text style={styles.label}>Índice</Text>
            <TextInput
              value={indice}
              onChangeText={setIndice}
              placeholder="EURIBOR 12M"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />

            <Text style={styles.label}>Diferencial (%)</Text>
            <TextInput
              value={diferencial}
              onChangeText={setDiferencial}
              keyboardType="decimal-pad"
              placeholder="Ej. 1.00"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
          </>
        ) : null}

        <Text style={styles.label}>Comisión apertura (€)</Text>
        <TextInput
          value={comApertura}
          onChangeText={setComApertura}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />

        <Text style={styles.label}>Otros gastos iniciales (€)</Text>
        <TextInput
          value={otrosIni}
          onChangeText={setOtrosIni}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
        />
      </FormSection>

      {isEdit ? (
        <FormSection title="Estado">
          <View style={styles.toggleRow}>
            <FormActionButton
              label="Activo"
              variant={activo ? 'primary' : 'secondary'}
              onPress={() => setActivo(true)}
              style={{ flex: 1 }}
            />
            <View style={{ width: spacing.sm }} />
            <FormActionButton
              label="Inactivo"
              variant={!activo ? 'primary' : 'secondary'}
              onPress={() => setActivo(false)}
              style={{ flex: 1 }}
            />
          </View>
        </FormSection>
      ) : null}
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    color: colors.textPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  simpleList: {
    marginTop: spacing.xs,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
});
