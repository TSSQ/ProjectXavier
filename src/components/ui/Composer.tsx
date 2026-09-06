/**
 * The seated composer (docs/design/composer-seated-with-xavier-spec.md) —
 * Messages' grammar: a detached "+" circle, a field, and a trailing slot
 * that morphs from a bare camera glyph (empty field) to a tinted Send disc
 * (typed field). Deliberately NOT wrapped in a container `Glass` — only the
 * "+" circle, the field itself and the Send disc are glass; the row between
 * them is plain, so it never reads as a second tab bar (the tray this
 * replaces did).
 *
 * The focus ring is a plain overlay `View`, never a change to the field
 * Glass's own props: Glass.tsx's header documents that a prop change
 * reaching a detached-tab GlassView re-assigns its effect to render nothing,
 * so focus/blur must never touch `material`/`edge`/`style` on the Glass
 * itself — only a sibling overlay may respond to focus.
 *
 * Visibility (`showPlus`/`showCamera`/`showSend`) is decided by the caller via
 * `src/domain/composerState.ts` — this component only renders what it's
 * told to.
 */
import React, { useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Glass } from './Glass';
import { icons } from '../../theme/assets';
import { radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';

export interface ComposerProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  /** Send tap and returnKeyType="send". */
  onSubmit: () => void;
  /** !busy, as today. */
  editable: boolean;
  inputRef: React.RefObject<TextInput | null>;
  showPlus: boolean;
  onPlus: (at: { x: number; y: number }) => void;
  /** Only honoured while `value` is empty. */
  showCamera: boolean;
  /** Decided by `composerState` — this component does not re-derive it. */
  showSend: boolean;
  onCamera: (at: { x: number; y: number }) => void;
  /** So the screen can dock the hero on focus (spec §4.2). */
  onFocusChange?: (focused: boolean) => void;
}

export function Composer({
  value,
  onChangeText,
  placeholder,
  onSubmit,
  editable,
  inputRef,
  showPlus,
  onPlus,
  showCamera,
  showSend,
  onCamera,
  onFocusChange,
}: ComposerProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const [focused, setFocused] = useState(false);



  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {showPlus && (
        <Pressable
          accessibilityLabel="More actions"
          onPress={(e) => onPlus({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        >
          <Glass
            material="clear"
            radius={radius.pill}
            isInteractive
            style={{
              width: s.composerHeight,
              height: s.composerHeight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name={icons.add} color={c.text} size={20} />
          </Glass>
        </Pressable>
      )}
      <Glass
        material="chrome"
        radius={radius.pill}
        style={{
          flex: 1,
          height: s.composerHeight,
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 18,
          paddingRight: 6,
          gap: 8,
        }}
      >
        <TextInput
          ref={inputRef}
          style={{
            flex: 1,
            fontSize: s.role.body,
            lineHeight: Math.round(s.role.body * 1.25),
            letterSpacing: 0,
            color: c.text,
          }}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={c.muted}
          onSubmitEditing={onSubmit}
          returnKeyType="send"
          editable={editable}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
        />
        {showCamera && (
          <Pressable
            accessibilityLabel="Scan photo"
            hitSlop={8}
            onPress={(e) => onCamera({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
            style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
          >
            <Feather name={icons.camera} color={c.muted} size={20} />
          </Pressable>
        )}
        {showSend && (
          <Pressable accessibilityLabel="Send" hitSlop={6} onPress={onSubmit}>
            <Glass
              material="tinted"
              radius={radius.pill}
              isInteractive
              style={{
                width: s.composerHeight - 12,
                height: s.composerHeight - 12,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Feather name={icons.send} color="#fff" size={18} />
            </Glass>
          </Pressable>
        )}
        {focused && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: radius.pill,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.primary,
            }}
          />
        )}
      </Glass>
    </View>
  );
}
