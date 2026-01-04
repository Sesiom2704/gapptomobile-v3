/**
 * Archivo: mobile_app/screens/prestamos/PrestamoFormScreen.tsx
 *
 * OBJETIVO (ajustes solicitados):
 *  1) "Cuentas" con formato pills (AccountPill) como en ingresos/gestionables.
 *  2) "Periodicidad" con pills (PillButton) como en ingresos/gestionables.
 *  3) "Principal" con estilo de importe (amountInputBig).
 *  4) "Tipo de interés" con pills (PillButton).
 *  5) "Datos básicos": PERSONAL / HIPOTECA con pills (PillButton).
 *  6) "Vivienda" con pills (AccountPill) como ingresos/gestionables.
 *
 * FIX adicional (bancos):
 *  - El selector “Banco” muestra SOLO proveedores de ramas BANCOS/FINANCIERAS
 *    (filtrado en prestamosApi.catalogs()) y limita la lista a 4 resultados.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Alert } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';

import FormScreen from '../../components/forms/FormScreen';
import { FormSection } from '../../components/forms/FormSection';
import { InlineSearchSelect } from '../../components/ui/InlineSearchSelect';
import { FormDateButton } from '../../components/ui/FormDateButton';
import { FormActionButton } from '../../components/ui/FormActionButton';
import { PillButton } from '../../components/ui/PillButton';
import { AccountPill } from '../../components/ui/AccountPill';
import { commonFormStyles } from '../../components/forms/formStyles';
import { colors, spacing } from '../../theme';

import { prestamosApi } from '../../services/prestamosApi';

// ------------------------------
// Tipos locales
// ------------------------------
type RouteParams = { prestamoId?: string };

// En catalogs() ya vienen filtrados por rama_id (BANCOS/FINANCIERAS) y mapeados.
type ProveedorBanco = { id: string; nombre: string; rama_id: string };

// Las cuentas del catálogo incluyen banco_id (para filtrar por banco seleccionado).
type Cuenta = { id: string; anagrama: string; banco_id?: string | null; liquidez?: number | null; nombre?: string };

// Viviendas del catálogo (patrimonios) para HIPOTECA.
type Vivienda = { id: string; referencia: string; direccion_completa?: string | null; activo?: boolean };

type Periodicidad = 'MENSUAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL';
type TipoInteres = 'FIJO' | 'VARIABLE' | 'MIXTO';

// Para préstamos mantenemos la lista "clásica".
const PERIODS: Periodicidad[] = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const TIPOS_INTERES: TipoInteres[] = ['FIJO', 'VARIABLE', 'MIXTO'];

const MAX_BANCOS_SUGERENCIAS = 4;

// ------------------------------
// Helpers fecha
// ------------------------------
function fmtDate(d: Date) {
  // UI: DD/MM/YYYY
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function isoDate(d: Date) {
  // API: YYYY-MM-DD
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normaliza textos numéricos en formato ES (“1.234,56”) a number.
 * Tolerante:
 *  - elimina puntos
 *  - cambia coma por punto
 */
function parseEuroNumber(text: string): number {
  const raw = String(text ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export default function PrestamoFormScreen() {
  const styles = commonFormStyles;

  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { prestamoId } = (route.params ?? {}) as RouteParams;
  const isEdit = !!prestamoId;

  // ------------------------------
  // Loading state
  // ------------------------------
  const [loading, setLoading] = useState(true);

  // ------------------------------
  // Catálogos
  // ------------------------------
  const [bancos, setBancos] = useState<ProveedorBanco[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [viviendas, setViviendas] = useState<Vivienda[]>([]);

  // ------------------------------
  // InlineSearchSelect query (banco)
  // ------------------------------
  const [qBanco, setQBanco] = useState('');

  // ------------------------------
  // Campos del form
  // ------------------------------
  const [clasificacion, setClasificacion] = useState<'PERSONAL' | 'HIPOTECA'>('PERSONAL');
  const [nombre, setNombre] = useState('');

  const [banco, setBanco] = useState<ProveedorBanco | null>(null);

  // Cuenta seleccionada por id (pills)
  const [cuentaId, setCuentaId] = useState<string | null>(null);

  // Vivienda seleccionada por id (pills)
  const [viviendaId, setViviendaId] = useState<string | null>(null);

  // Fecha inicio
  const [fechaInicio, setFechaInicio] = useState<Date>(new Date());
  const [showDate, setShowDate] = useState(false);

  // Condiciones
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>('MENSUAL');
  const [plazoMeses, setPlazoMeses] = useState('120');

  // Principal: UI como importe
  const [principal, setPrincipal] = useState('');

  // Tipo de interés: pills
  const [tipoInteres, setTipoInteres] = useState<TipoInteres>('FIJO');
  const [tin, setTin] = useState('3.00');
  const [tae, setTae] = useState('');
  const [indice, setIndice] = useState('');
  const [diferencial, setDiferencial] = useState('');

  // Gastos iniciales
  const [comApertura, setComApertura] = useState('0');
  const [otrosIni, setOtrosIni] = useState('0');

  // Estado
  const [activo, setActivo] = useState(true);

  // ---------------------------------------------------------
  // Derivados: cuentas filtradas por banco
  // ---------------------------------------------------------
  const cuentasFiltradas = useMemo(() => {
    if (!banco?.id) return cuentas;
    return cuentas.filter((c) => String(c.banco_id ?? '') === String(banco.id));
  }, [cuentas, banco]);

  // ---------------------------------------------------------
  // Derivados: bancos filtrados por query + limit 4
  // (bancos ya filtrados por rama en prestamosApi.catalogs)
  // ---------------------------------------------------------
  const bancosFilteredByQuery = useMemo(() => {
    const qq = qBanco.trim().toUpperCase();
    const base = bancos ?? [];
    const filtered = !qq ? base : base.filter((b) => String(b.nombre ?? '').toUpperCase().includes(qq));
    return filtered.slice(0, MAX_BANCOS_SUGERENCIAS);
  }, [bancos, qBanco]);

  // ---------------------------------------------------------
  // Derivados: viviendas activas
  // ---------------------------------------------------------
  const viviendasActivas = useMemo(() => {
    return (viviendas ?? []).filter((v) => v.activo !== false);
  }, [viviendas]);

  // ---------------------------------------------------------
  // Labels
  // ---------------------------------------------------------
  const getCuentaLabel = (cta: Cuenta): string => cta.anagrama || cta.nombre || cta.id;
  const getViviendaLabel = (viv: Vivienda): string => viv.referencia || viv.id;

  // ---------------------------------------------------------
  // Load catálogos + (si edición) load préstamo
  // ---------------------------------------------------------
  const loadAll = useCallback(async () => {
    try {
      setLoading(true);

      const catalogs = await prestamosApi.catalogs();

      // Bancos ya filtrados por rama (BANCOS/FINANCIERAS)
      setBancos(Array.isArray(catalogs?.bancos) ? (catalogs.bancos as any) : []);
      setCuentas(Array.isArray(catalogs?.cuentas) ? (catalogs.cuentas as any) : []);
      setViviendas(Array.isArray(catalogs?.viviendas) ? (catalogs.viviendas as any) : []);

      if (isEdit && prestamoId) {
        const p = await prestamosApi.get(prestamoId);

        setNombre(String(p?.nombre ?? ''));

        // Clasificación: si tiene vivienda => HIPOTECA
        setClasificacion(p?.referencia_vivienda_id ? 'HIPOTECA' : 'PERSONAL');

        // Banco por proveedor_id
        const bancoFound = (catalogs?.bancos ?? []).find((x: any) => String(x.id) === String(p?.proveedor_id));
        setBanco((bancoFound as any) ?? null);

        // Cuenta por id
        setCuentaId(p?.cuenta_id ? String(p.cuenta_id) : null);

        // Vivienda por id
        setViviendaId(p?.referencia_vivienda_id ? String(p.referencia_vivienda_id) : null);

        // Fecha
        setFechaInicio(p?.fecha_inicio ? new Date(String(p.fecha_inicio)) : new Date());

        // Periodicidad
        const per = String(p?.periodicidad ?? 'MENSUAL').toUpperCase();
        setPeriodicidad((PERIODS.includes(per as any) ? (per as any) : 'MENSUAL') as Periodicidad);

        // Plazo / principal
        setPlazoMeses(String(p?.plazo_meses ?? '120'));
        setPrincipal(String(p?.importe_principal ?? ''));

        // Interés
        const ti = String(p?.tipo_interes ?? 'FIJO').toUpperCase();
        setTipoInteres((TIPOS_INTERES.includes(ti as any) ? (ti as any) : 'FIJO') as TipoInteres);

        setTin(String(p?.tin_pct ?? ''));
        setTae(p?.tae_pct != null ? String(p.tae_pct) : '');
        setIndice(String(p?.indice ?? ''));
        setDiferencial(p?.diferencial_pct != null ? String(p.diferencial_pct) : '');

        // Iniciales
        setComApertura(String(p?.comision_apertura ?? '0'));
        setOtrosIni(String(p?.otros_gastos_iniciales ?? '0'));

        // Estado
        setActivo(Boolean(p?.activo ?? true));
      }
    } catch (e) {
      console.error('[PrestamoForm] Error cargando', e);
      Alert.alert('Error', 'No se pudo cargar el formulario de préstamo.');
    } finally {
      setLoading(false);
    }
  }, [isEdit, prestamoId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ---------------------------------------------------------
  // Si cambia banco, limpiar cuenta si ya no pertenece
  // ---------------------------------------------------------
  useEffect(() => {
    if (!banco?.id) return;
    if (!cuentaId) return;

    const stillValid = cuentasFiltradas.some((c) => c.id === cuentaId);
    if (!stillValid) setCuentaId(null);
  }, [banco, cuentaId, cuentasFiltradas]);

  // ---------------------------------------------------------
  // Si cambia clasificación a PERSONAL, limpiar vivienda
  // ---------------------------------------------------------
  useEffect(() => {
    if (clasificacion === 'PERSONAL') setViviendaId(null);
  }, [clasificacion]);

  // ---------------------------------------------------------
  // Guardar
  // ---------------------------------------------------------
  const onSave = useCallback(async () => {
    if (!nombre.trim()) return Alert.alert('Atención', 'Indica un nombre.');
    if (!banco?.id) return Alert.alert('Atención', 'Selecciona un banco.');
    if (!cuentaId) return Alert.alert('Atención', 'Selecciona una cuenta.');

    if (clasificacion === 'HIPOTECA' && !viviendaId) {
      return Alert.alert('Atención', 'Selecciona una vivienda.');
    }

    const plazo = parseInt(plazoMeses || '0', 10);
    const principalNum = parseEuroNumber(principal);
    const tinNum = parseEuroNumber(tin);

    if (plazo <= 0) return Alert.alert('Atención', 'Plazo inválido.');
    if (principalNum <= 0) return Alert.alert('Atención', 'Principal debe ser > 0.');
    if (tinNum <= 0) return Alert.alert('Atención', 'TIN debe ser > 0.');

    const payload: any = {
      nombre: nombre.trim().toUpperCase(),

      proveedor_id: banco.id,
      cuenta_id: cuentaId,
      referencia_vivienda_id: clasificacion === 'HIPOTECA' ? viviendaId : null,

      fecha_inicio: isoDate(fechaInicio),
      periodicidad,
      plazo_meses: plazo,
      importe_principal: principalNum,

      tipo_interes: tipoInteres,
      tin_pct: tinNum,
      tae_pct: tae ? parseEuroNumber(tae) : null,

      indice: tipoInteres === 'FIJO' ? null : (indice || null),
      diferencial_pct: tipoInteres === 'FIJO' ? null : (diferencial ? parseEuroNumber(diferencial) : null),

      comision_apertura: parseEuroNumber(comApertura) || 0,
      otros_gastos_iniciales: parseEuroNumber(otrosIni) || 0,

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
      console.error('[PrestamoForm] Error guardando', e);
      Alert.alert('Error', String(msg));
    }
  }, [
    nombre,
    banco,
    cuentaId,
    clasificacion,
    viviendaId,
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

  const title = 'Préstamo';
  const subtitle = isEdit ? 'Edición' : 'Alta';

  return (
    <FormScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      onBackPress={() => navigation.goBack()}
      footer={
        <View style={stylesLocal.footerRow}>
          <View style={{ flex: 1 }}>
            <FormActionButton label="Cancelar" variant="secondary" onPress={() => navigation.goBack()} />
          </View>

          <View style={{ width: spacing.sm }} />

          <View style={{ flex: 1 }}>
            <FormActionButton label={isEdit ? 'Actualizar' : 'Guardar'} variant="primary" onPress={onSave} />
          </View>
        </View>
      }
    >
      <FormSection title="Datos básicos">
        <View style={styles.field}>
          <Text style={styles.label}>Tipo</Text>
          <View style={styles.segmentosRow}>
            <View style={styles.segmentoWrapper}>
              <PillButton label="PERSONAL" selected={clasificacion === 'PERSONAL'} onPress={() => setClasificacion('PERSONAL')} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton label="HIPOTECA" selected={clasificacion === 'HIPOTECA'} onPress={() => setClasificacion('HIPOTECA')} />
            </View>
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Nombre</Text>
          <TextInput
            value={nombre}
            onChangeText={setNombre}
            placeholder="Ej. HIPOTECA PISO CENTRO"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, nombre.trim() !== '' && styles.inputFilled]}
          />
        </View>
      </FormSection>

      <FormSection title="Banco y cuenta">
        <View style={styles.field}>
          <InlineSearchSelect<ProveedorBanco>
            label="Banco"
            onAddPress={() => {}}
            addAccessibilityLabel="Añadir (no aplica)"
            disabled={false}
            selected={banco}
            selectedLabel={(x) => x.nombre}
            onClear={() => {
              setBanco(null);
              setCuentaId(null);
              setQBanco('');
            }}
            query={qBanco}
            onChangeQuery={setQBanco}
            placeholder="Buscar banco…"
            options={bancosFilteredByQuery}
            optionKey={(x) => x.id}
            optionLabel={(x) => x.nombre}
            onSelect={(x) => {
              setBanco(x);
              setCuentaId(null);
              setQBanco('');
            }}
            emptyText="Sin resultados"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Cuenta</Text>

          {!banco ? <Text style={styles.helperText}>Selecciona primero un banco para ver sus cuentas.</Text> : null}
          {banco && cuentasFiltradas.length === 0 ? <Text style={styles.helperText}>No hay cuentas asociadas a este banco.</Text> : null}

          <View style={styles.accountsRow}>
            {(banco ? cuentasFiltradas : cuentas).map((cta) => (
              <View key={cta.id} style={styles.accountPillWrapper}>
                <AccountPill
                  label={getCuentaLabel(cta)}
                  subLabel={
                    typeof cta.liquidez === 'number'
                      ? `${cta.liquidez.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
                      : undefined
                  }
                  selected={cuentaId === cta.id}
                  onPress={() => setCuentaId((prev) => (prev === cta.id ? null : cta.id))}
                />
              </View>
            ))}
          </View>
        </View>

        {clasificacion === 'HIPOTECA' ? (
          <View style={styles.field}>
            <Text style={styles.label}>Vivienda</Text>

            {viviendasActivas.length === 0 ? <Text style={styles.helperText}>No hay viviendas disponibles.</Text> : null}

            <View style={styles.accountsRow}>
              {viviendasActivas.map((v) => (
                <View key={v.id} style={styles.accountPillWrapper}>
                  <AccountPill
                    label={getViviendaLabel(v)}
                    subLabel={v.direccion_completa ?? ''}
                    selected={viviendaId === v.id}
                    onPress={() => setViviendaId((prev) => (prev === v.id ? null : v.id))}
                  />
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </FormSection>

      <FormSection title="Condiciones">
        <View style={styles.field}>
          <Text style={styles.label}>Fecha inicio</Text>
          <FormDateButton valueText={fmtDate(fechaInicio)} onPress={() => setShowDate(true)} disabled={false} />

          {showDate ? (
            <DateTimePicker
              value={fechaInicio}
              mode="date"
              display="default"
              onChange={(_, d) => {
                setShowDate(false);
                if (d) setFechaInicio(d);
              }}
            />
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Periodicidad</Text>
          <View style={styles.periodicidadRow}>
            {PERIODS.map((p) => (
              <View key={p} style={styles.periodicidadPillWrapper}>
                <PillButton label={p} selected={periodicidad === p} onPress={() => setPeriodicidad(p)} />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Plazo (meses)</Text>
          <TextInput
            value={plazoMeses}
            onChangeText={setPlazoMeses}
            keyboardType="number-pad"
            placeholder="Ej. 120"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, plazoMeses.trim() !== '' && styles.inputFilled]}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Principal (€)</Text>
          <TextInput
            value={principal}
            onChangeText={setPrincipal}
            keyboardType="decimal-pad"
            placeholder="Ej. 150.000,00"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, styles.amountInputBig, principal.trim() !== '' && styles.inputFilled]}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Tipo de interés</Text>
          <View style={styles.segmentosRow}>
            {TIPOS_INTERES.map((t) => (
              <View key={t} style={styles.segmentoWrapper}>
                <PillButton label={t} selected={tipoInteres === t} onPress={() => setTipoInteres(t)} />
              </View>
            ))}
          </View>
        </View>

        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>TIN (%)</Text>
            <TextInput
              value={tin}
              onChangeText={setTin}
              keyboardType="decimal-pad"
              placeholder="Ej. 3,10"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, tin.trim() !== '' && styles.inputFilled]}
            />
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>TAE (%)</Text>
            <TextInput
              value={tae}
              onChangeText={setTae}
              keyboardType="decimal-pad"
              placeholder="Opcional"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, tae.trim() !== '' && styles.inputFilled]}
            />
          </View>
        </View>

        {tipoInteres !== 'FIJO' ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Índice</Text>
              <TextInput
                value={indice}
                onChangeText={setIndice}
                placeholder="Ej. EURIBOR 12M"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, indice.trim() !== '' && styles.inputFilled]}
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Diferencial (%)</Text>
              <TextInput
                value={diferencial}
                onChangeText={setDiferencial}
                keyboardType="decimal-pad"
                placeholder="Ej. 1,00"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, diferencial.trim() !== '' && styles.inputFilled]}
              />
            </View>
          </>
        ) : null}

        <View style={styles.fieldRowTwoCols}>
          <View style={styles.col}>
            <Text style={styles.label}>Comisión apertura (€)</Text>
            <TextInput
              value={comApertura}
              onChangeText={setComApertura}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, comApertura.trim() !== '' && styles.inputFilled]}
            />
          </View>

          <View style={styles.col}>
            <Text style={styles.label}>Otros gastos iniciales (€)</Text>
            <TextInput
              value={otrosIni}
              onChangeText={setOtrosIni}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, otrosIni.trim() !== '' && styles.inputFilled]}
            />
          </View>
        </View>
      </FormSection>

      {isEdit ? (
        <FormSection title="Estado">
          <View style={styles.segmentosRow}>
            <View style={styles.segmentoWrapper}>
              <PillButton label="Activo" selected={activo} onPress={() => setActivo(true)} />
            </View>
            <View style={styles.segmentoWrapper}>
              <PillButton label="Inactivo" selected={!activo} onPress={() => setActivo(false)} />
            </View>
          </View>
        </FormSection>
      ) : null}
    </FormScreen>
  );
}

const stylesLocal = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
});
