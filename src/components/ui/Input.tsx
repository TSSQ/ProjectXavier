import React, { forwardRef } from 'react';
import { TextInput, TextInputProps } from 'react-native';

/**
 * Shared single-line text input with app field styling. Taller than the raw
 * TextInput so the iOS caret is never clipped. Forwards all TextInputProps and
 * the ref so the parent can focus/blur programmatically.
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
      className={`bg-surfaceAlt text-text rounded-sm px-3 py-3 text-base ${className ?? ''}`}
      style={[{ minHeight: 44, lineHeight: 20, letterSpacing: 0 }, style]}
      placeholderTextColor="#9AA4B2"
      {...rest}
    />
  );
});
