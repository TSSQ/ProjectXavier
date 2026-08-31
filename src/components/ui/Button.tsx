/**
 * The app's one button.
 *
 * Every confirmation surface should look like the assistant's draft card —
 * a row of equal-width pills (Discard · Edit · Save). That only works if the
 * shared component can express every tone those surfaces need, and it
 * couldn't: with just `primary` and `ghost`, anything destructive had to be
 * hand-rolled, which is how the delete confirmation ended up a full-width
 * stacked button with a text link underneath.
 *
 * `destructive` closes that gap. The label is also Dynamic-Type scaled now
 * (`role.control`, base 16 — identical at default settings, larger when the
 * user asks for larger text): the hand-rolled buttons already did this, so
 * standardising on a fixed-size component would have been a regression on
 * exactly the axis this app has been bitten by before.
 */
import React, { useState } from 'react';
import { Pressable, PressableProps, Text, ActivityIndicator } from 'react-native';
import { cn } from './cn';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

type Variant = 'primary' | 'ghost' | 'destructive';

export function Button({
  title,
  variant = 'primary',
  loading = false,
  className,
  ...rest
}: PressableProps & { title: string; variant?: Variant; loading?: boolean }) {
  const c = useThemeColors();
  const s = useScaledType();
  const [pressed, setPressed] = useState(false);

  const surface =
    variant === 'primary' ? 'bg-primaryFill' : variant === 'destructive' ? '' : 'bg-controlRaised';
  const label =
    variant === 'ghost' ? 'text-text' : variant === 'destructive' ? '' : 'text-white';

  return (
    <Pressable
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      className={cn('rounded-pill py-3 items-center justify-center', surface, className)}
      // Plain object style — the function form is silently swallowed by
      // NativeWind's cssInterop (see .eslintrc.js). `negative` has no Tailwind
      // background utility that reads from the theme hook, so the destructive
      // fill is set here rather than as a class.
      style={{
        minHeight: 44,
        opacity: pressed ? 0.85 : 1,
        // A ghost button IS the control, so it must read as lifted off the
        // surface behind it. In light mode that cannot come from colour —
        // controlRaised is white and so is the card — so the elevation token
        // carries it. In dark the token is deliberately near-nothing, because
        // the surface ladder already says "in front".
        ...(variant === 'ghost' ? c.elevation.raised : null),
        ...(variant === 'destructive' ? { backgroundColor: c.negative } : null),
      }}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text
          className={cn('font-bold', label)}
          numberOfLines={1}
          style={{
            fontSize: s.role.control,
            ...(variant === 'destructive' ? { color: c.onAccent } : null),
          }}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
