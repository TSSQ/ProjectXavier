/**
 * The seated composer (docs/design/composer-seated-with-xavier-spec.md) —
 * Messages' grammar: a detached "+" circle, a field, and a trailing slot
 * that morphs from a bare camera glyph (empty field) to a tinted Send disc
 * (typed field). Deliberately NOT wrapped in a container `Glass` — only the
 * "+" circle (an `IconButton`), the field itself and the Send disc
 * (`IconButton` too) are glass; the row between them is plain, so it never
 * reads as a second tab bar (the tray this replaces did).
 *
 * The field is `multiline` and grows with its text, from `s.composerHeight`
 * to a cap of ~5 lines, then scrolls internally (§12 E2). That growth is the
 * reason the field's material is split from its content, rather than one
 * `Glass` wrapping everything the way "+" and Send still do: a GlassView
 * applies its native effect only on its OWN first layout (Glass.tsx header)
 * — resizing an EXISTING instance as the field grows would leave the newly
 * grown area unblurred, the exact hazard this branch already hit twice
 * (ScreenHeader's search field, the resized tray). So the field renders as a
 * CHILDLESS `Glass` sibling — absolutely positioned behind the content,
 * sized off the measured height and KEYED on it (`settleMeasuredHeight`, the
 * same idiom as ScreenHeader.tsx) — with the real content (the TextInput,
 * trailing slot, focus ring) in normal flow in FRONT of it. A height change
 * mounts a fresh, correctly-sized Glass instance; the TextInput in front of
 * it never remounts and so never drops focus mid-sentence.
 *
 * The focus ring is a plain overlay `View` inside that content layer, never
 * a change to either Glass's own props: Glass.tsx's header documents that a
 * prop change reaching a detached-tab GlassView re-assigns its effect to
 * render nothing, so focus/blur must never touch `material`/`edge`/`style`
 * on a Glass itself — only a sibling overlay may respond to focus.
 *
 * Visibility (`showPlus`/`showCamera`/`showSend`) is decided by the caller via
 * `src/domain/composerState.ts` — this component only renders what it's
 * told to.
 */
import React, { useState } from 'react';
import { View, TextInput, StyleSheet, LayoutChangeEvent } from 'react-native';
import { Glass } from './Glass';
import { IconButton } from './IconButton';
import { icons } from '../../theme/assets';
import { radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { useGlass } from '../../theme/useGlass';
import { settleMeasuredHeight } from '../../domain/layoutSettle';
import { mayMountGlass } from '../../domain/glassMountGate';

export interface ComposerProps {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  /** Send tap and the return key. The field is `multiline` so long entries
   *  wrap instead of scrolling sideways, but `submitBehavior="submit"` keeps
   *  return meaning SEND rather than inserting a newline — multiline here is
   *  for wrapping, not for composing paragraphs, and silently changing what
   *  return does would break the fastest way to file an expense.
   */
  onSubmit: () => void;
  /** !busy, as today. */
  editable: boolean;
  inputRef: React.RefObject<TextInput | null>;
  showPlus: boolean;
  onPlus: () => void;
  /** Decided by `composerState` — this component does not re-derive it. */
  showCamera: boolean;
  /** Decided by `composerState` — this component does not re-derive it. */
  showSend: boolean;
  /** No point/coordinate — the photo-source menu this opens anchors itself
   *  to the composer by layout (ContextMenu's `bottomRight` mode), not to a
   *  captured touch point. Same shape as `onPlus` next to it. */
  onCamera: () => void;
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
}: ComposerProps) {
  const c = useThemeColors();
  const s = useScaledType();
  const { tier, tokens } = useGlass();
  const [focused, setFocused] = useState(false);

  // The field's own measured height, settled to a whole point so sub-pixel
  // jitter doesn't remount the Glass for nothing (see layoutSettle.ts).
  // `showFieldGlass` mirrors ScreenHeader's opaque-tier handling: on the
  // native tier the Glass sibling below supplies the fill; on the opaque
  // tier (Reduce Transparency, or no glass API) there's no first-layout
  // hazard to key around, so the content layer paints its own solid fill
  // instead (the same fallback colour Glass.tsx would have used).
  const [fieldHeight, setFieldHeight] = useState<number | null>(null);
  // No `entered` — this field mounts with the screen, no Reanimated
  // `entering` ancestor to wait for (glassMountGate.ts).
  const showFieldGlass = mayMountGlass({ tier, measured: fieldHeight });

  const handleFieldLayout = (e: LayoutChangeEvent) => {
    setFieldHeight(settleMeasuredHeight(e.nativeEvent.layout.height));
  };

  // Symmetric top/bottom padding inside the TextInput keeps a single line
  // centred at exactly the old fixed `composerHeight`, and stays as the
  // field grows, so the box grows evenly around the text instead of the
  // text creeping toward one edge. Capped at ~5 lines, after which the
  // TextInput scrolls internally (a bounded multiline TextInput scrolls by
  // default).
  const lineHeight = Math.round(s.role.body * 1.25);
  const vPad = Math.max(8, Math.round((s.composerHeight - lineHeight) / 2));
  const maxFieldHeight = vPad * 2 + lineHeight * 5;

  return (
    // `alignItems: 'flex-end'` (was 'center'): as the field grows taller than
    // "+", bottom-aligning it and the trailing slot against the field's last
    // line reads better than either floating at the vertical centre of a now
    // -tall row or pinned to its top (the Messages precedent this component
    // already follows does the same).
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      {showPlus && (
        <IconButton size="lg" tone="clear" icon={icons.add} onPress={onPlus} accessibilityLabel="More actions" />
      )}
      <View style={{ flex: 1 }}>
        {showFieldGlass && (
          <Glass
            key={fieldHeight}
            material="chrome"
            radius={radius.pill}
            pointerEvents="none"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: fieldHeight! }}
          />
        )}
        <View
          onLayout={handleFieldLayout}
          style={{
            minHeight: s.composerHeight,
            maxHeight: maxFieldHeight,
            borderRadius: radius.pill,
            overflow: 'hidden',
            backgroundColor: showFieldGlass ? 'transparent' : tokens.chrome.fallback,
            // Border width is constant across both phases (only its colour
            // swaps out) — same fix as BottomSheet's own shell, and for the
            // same reason: a conditional borderWidth here was the QA
            // round-1 Reduce Transparency defect (0.67pt border-box growth
            // on the opaque tier, which nudged the flex-end Send/camera
            // glyphs and displaced the MenuPanel above).
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: showFieldGlass ? 'transparent' : tokens.chrome.edge,
            flexDirection: 'row',
            alignItems: 'flex-end',
            paddingLeft: 18,
            paddingRight: 6,
            gap: 8,
          }}
        >
          <TextInput
            ref={inputRef}
            multiline
            style={{
              flex: 1,
              fontSize: s.role.body,
              lineHeight,
              letterSpacing: 0,
              color: c.text,
              paddingVertical: vPad,
              maxHeight: maxFieldHeight,
            }}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            onSubmitEditing={onSubmit}
            returnKeyType="send"
            // Without this a multiline TextInput swallows return as a
            // newline and never fires onSubmitEditing (iOS).
            submitBehavior="submit"
            editable={editable}
            onFocus={() => {
              setFocused(true);
            }}
            onBlur={() => {
              setFocused(false);
            }}
          />
          {showCamera && (
            <View style={{ marginBottom: 6 }}>
              <IconButton size="sm" icon={icons.camera} onPress={onCamera} accessibilityLabel="Scan photo" />
            </View>
          )}
          {showSend && (
            <View style={{ marginBottom: 6 }}>
              <IconButton size="md" tone="tinted" icon={icons.send} onPress={onSubmit} accessibilityLabel="Send" />
            </View>
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
        </View>
      </View>
    </View>
  );
}
