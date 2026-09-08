import React, { forwardRef, useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { useThemeColors } from '../../theme/useThemeColors';

/**
 * Shared single-line text input with app field styling. Aligned to the design
 * TextField: surface bg, 1px border, radius-sm (8), minHeight 48, placeholder
 * in muted tone. Forwards all TextInputProps and the ref so the parent can
 * focus/blur programmatically.
 *
 * Focus paints the border `primary` (glass-standard-adoption-spec.md S5) —
 * tracked locally so the border swap never depends on the caller wiring its
 * own onFocus/onBlur; callers that DO pass their own are still called (see
 * below), they just don't have to for the border to work.
 *
 * Callers may pass `className` to extend/override NativeWind classes — it is
 * merged after the base classes so it takes precedence. The `style` prop is
 * merged the same way. `placeholderTextColor` defaults to the app muted tone.
 */
export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { className, style, onFocus, onBlur, ...rest },
  ref,
) {
  const c = useThemeColors();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      className={`bg-surface text-text border rounded-sm px-3 py-3 text-base ${className ?? ''}`}
      style={[
        { minHeight: 48, lineHeight: 20, letterSpacing: 0, borderColor: focused ? c.primary : c.border },
        style,
      ]}
      placeholderTextColor={c.muted}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      {...rest}
    />
  );
});
