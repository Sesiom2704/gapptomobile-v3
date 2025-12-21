// mobile_app/utils/formsUtils.ts
import React from 'react';
import { useFocusEffect } from '@react-navigation/native';

type ResetFocusParams = {
  /**
   * Si true, no se resetea nunca (consulta).
   */
  readOnly: boolean;

  /**
   * Si true, estamos editando (no resetees).
   */
  isEdit: boolean;

  /**
   * Si existe, normalmente significa que venimos de una pantalla auxiliar (p.ej. AuxEntityForm).
   * En ese caso, NO queremos resetear en el foco, para no pisar los cambios entrantes.
   */
  auxResult?: unknown;

  /**
   * Función que resetea el formulario (la define cada pantalla).
   */
  onReset: () => void;

  /**
   * Si necesitas lógica más específica (por ejemplo, permitir reset aunque haya auxResult),
   * puedes sobreescribir el comportamiento con este predicate.
   */
  shouldResetOverride?: (ctx: { readOnly: boolean; isEdit: boolean; auxResult?: unknown }) => boolean;
};

/**
 * Hook estándar para resetear formularios al enfocar la pantalla en modo "Nuevo".
 * Regla por defecto:
 * - Solo si !readOnly && !isEdit
 * - y NO hay auxResult
 */
export function useResetFormOnFocus(params: ResetFocusParams) {
  const { readOnly, isEdit, auxResult, onReset, shouldResetOverride } = params;

  useFocusEffect(
    React.useCallback(() => {
      const ctx = { readOnly, isEdit, auxResult };
      const shouldReset =
        typeof shouldResetOverride === 'function'
          ? shouldResetOverride(ctx)
          : !readOnly && !isEdit && !auxResult;

      if (shouldReset) {
        onReset();
      }
    }, [readOnly, isEdit, auxResult, onReset, shouldResetOverride])
  );
}
