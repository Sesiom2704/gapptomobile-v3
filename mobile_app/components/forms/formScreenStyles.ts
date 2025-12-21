// mobile_app/components/forms/formScreenStyles.ts
import { StyleSheet } from 'react-native';
import { spacing } from '../../theme';

export const formScreenStyles = StyleSheet.create({
  formArea: {
    flex: 1,
  },
  formContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },

  footerInScroll: {
    marginTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
});
