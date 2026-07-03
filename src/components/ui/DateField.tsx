/**
 * A tappable date field that opens the native date picker
 * (@react-native-community/datetimepicker). Value is epoch ms; the field shows
 * it as dd-MM-yyyy. On iOS the spinner is presented in a bottom modal (so it
 * gets full width regardless of where the field sits); on Android it's the
 * platform dialog. Native module — needs a dev build, not just a JS reload.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, Platform, Modal, Keyboard } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker, {
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { formatDMY } from '../../domain/dates';
import { colors } from '../../theme/tokens';

/**
 * Controlled-open API (optional, back-compat):
 *   - `open` / `onOpenChange`: when provided the parent drives visibility.
 *   - `hideTrigger`: when true the inline Pressable trigger is not rendered.
 * All three default to undefined / false so existing callers are unchanged.
 */
export function DateField({
  value,
  onChange,
  accessibilityLabel = 'Pick a date',
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  value: number;
  onChange: (ms: number) => void;
  accessibilityLabel?: string;
  /** Controlled open state. When provided, the parent drives visibility. */
  open?: boolean;
  /** Called when the picker wants to open or close itself. */
  onOpenChange?: (v: boolean) => void;
  /** When true, the inline trigger Pressable is not rendered. */
  hideTrigger?: boolean;
}) {
  const [showInternal, setShowInternal] = useState(false);

  // Resolve controlled vs uncontrolled show state.
  const show = openProp !== undefined ? openProp : showInternal;
  const setShow = (v: boolean) => {
    if (openProp !== undefined) {
      onOpenChange?.(v);
    } else {
      setShowInternal(v);
    }
  };

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    // Android fires once and dismisses itself; iOS stays open inside the modal.
    if (Platform.OS !== 'ios') setShow(false);
    if (event.type === 'set' && selected) onChange(selected.getTime());
  };

  return (
    <View style={hideTrigger ? undefined : { flex: 1 }}>
      {!hideTrigger && (
        <Pressable
          onPress={() => { Keyboard.dismiss(); setShow(true); }}
          accessibilityLabel={accessibilityLabel}
          className="flex-row items-center justify-between bg-surfaceAlt rounded-sm px-3 py-3"
          style={{ minHeight: 44 }}
        >
          <Text className="text-text text-base">{formatDMY(value)}</Text>
          <Feather name="calendar" size={16} color={colors.textMuted} />
        </Pressable>
      )}

      {/* Android: the picker is a system dialog — mounting it is enough. */}
      {show && Platform.OS !== 'ios' && (
        <DateTimePicker
          value={new Date(value)}
          mode="date"
          display="default"
          onChange={handleChange}
          maximumDate={new Date()}
        />
      )}

      {/* iOS: present the spinner in a bottom modal so it gets full width. */}
      {Platform.OS === 'ios' && (
        <Modal visible={show} transparent animationType="slide" onRequestClose={() => setShow(false)}>
          <Pressable className="flex-1 bg-black/55" onPress={() => setShow(false)} />
          <View className="bg-[#23262C] rounded-t-[22px] px-4 pb-4 pt-2">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="text-muted text-[13px]">Pick a date</Text>
              <Pressable onPress={() => setShow(false)} accessibilityLabel="Done picking date">
                <Text className="text-primary text-[15px] font-bold px-2 py-1">Done</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={new Date(value)}
              mode="date"
              display="spinner"
              themeVariant="dark"
              onChange={handleChange}
              maximumDate={new Date()}
            />
          </View>
        </Modal>
      )}
    </View>
  );
}
