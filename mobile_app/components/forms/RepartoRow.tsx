// mobile_app/components/forms/RepartoRow.tsx
import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../theme';
import { commonFormStyles } from './formStyles';

type Props = {
  // Cantidad
  cantidad: string;
  onChangeCantidad: (v: string) => void;
  cantidadDisabled?: boolean;

  // Importe (mi parte)
  importe: string;
  onChangeImporte: (v: string) => void;
  importeDisabled?: boolean;

  // Participo (display)
  participo: boolean;
  participoDisabled?: boolean;

  // Para reutilizar labels/copy si alguna vez cambia
  labelCantidad?: string;
  labelImporte?: string;
  labelParticipo?: string;

  readOnly?: boolean;
};

export const RepartoRow: React.FC<Props> = ({
  cantidad,
  onChangeCantidad,
  cantidadDisabled = false,

  importe,
  onChangeImporte,
  importeDisabled = false,

  participo,
  participoDisabled = true,

  labelCantidad = 'Cantidad',
  labelImporte = 'Importe',
  labelParticipo = 'Participo',

  readOnly = false,
}) => {
  const styles = commonFormStyles;

  return (
    <View>
      <View style={s.repartoRow}>
        {/* Cantidad */}
        <View style={s.repartoColCantidad}>
          <Text style={styles.label}>{labelCantidad}</Text>
          <TextInput
            style={[
              styles.input,
              s.repartoInputNarrow,
              cantidad && styles.inputFilled,
              (cantidadDisabled || readOnly) && styles.inputDisabled,
            ]}
            keyboardType="numeric"
            value={cantidad}
            editable={!readOnly && !cantidadDisabled}
            onChangeText={onChangeCantidad}
          />
        </View>

        {/* Importe */}
        <View style={s.repartoColImporte}>
          <Text style={styles.label}>{labelImporte}</Text>
          <TextInput
            style={[
              styles.input,
              s.repartoInputNarrow,
              importe && styles.inputFilled,
              (importeDisabled || readOnly) && styles.inputDisabled,
            ]}
            keyboardType="decimal-pad"
            value={importe}
            editable={!readOnly && !importeDisabled}
            onChangeText={onChangeImporte}
          />
        </View>

        {/* Participo */}
        <View style={s.repartoColParticipo}>
          <Text style={styles.label}>{labelParticipo}</Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => undefined}
            style={[
              s.participoPill,
              participo ? s.participoPillOn : s.participoPillOff,
              (readOnly || participoDisabled) && s.participoPillDisabled,
            ]}
          >
            <Text
              style={[
                s.participoPillText,
                participo ? s.participoPillTextOn : s.participoPillTextOff,
              ]}
              numberOfLines={1}
            >
              {participo ? 'PARTICIPO' : 'NO'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  repartoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 10,
  },

  repartoColCantidad: {
    flexBasis: 80,
    flexGrow: 0,
    flexShrink: 0,
  },

  repartoColImporte: {
    flexBasis: 110,
    flexGrow: 0,
    flexShrink: 0,
  },

  repartoColParticipo: {
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 70,
  },

  repartoInputNarrow: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },

  participoPill: {
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  participoPillOn: {
    borderColor: colors.primaryStrong,
    backgroundColor: 'transparent',
  },
  participoPillOff: {
    borderColor: colors.textSecondary,
    backgroundColor: 'transparent',
  },
  participoPillDisabled: {
    opacity: 0.75,
  },
  participoPillText: {
    fontWeight: '700',
    fontSize: 12,
  },
  participoPillTextOn: {
    color: colors.primaryStrong,
  },
  participoPillTextOff: {
    color: colors.textSecondary,
  },
});

export default RepartoRow;
