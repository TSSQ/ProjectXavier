import React, { forwardRef } from 'react';
import { TextInput, TextInputProps } from 'react-native';

/**
 * Shared single-line text input with app field styling. Aligned to the design
 * TextField: surface bg, 1px border, radius-sm (8), minHeight 48, placeholder
 * in muted tone. Forwards all TextInputProps and the ref so the parent can
 * focus/blur programmatically.
 *
 * Callers may pass `className` to extend/override NativeWind classes — it is
 * merged after the base classes so it takes precedence. The `style` prop is
 * merged the same way. `placeholderTextColor` defaults to the app muted tone.
 */
export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { className, style, ...rest },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      className={`bg-surface text-text border border-border rounded-sm px-3 py-3 text-base ${className ?? ''}`}
      style={[{ minHeight: 48, lineHeight: 20, letterSpacing: 0 }, style]}
      placeholderTextColor="#9AA4B2"
      {...rest}
    />
  );
});
