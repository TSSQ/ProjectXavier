import React from 'react';
import { View } from 'react-native';
import { icons } from '../../theme/assets';
import { useThemeColors } from '../../theme/useThemeColors';
import { AssistantCommand, PlusMenuRow } from '../../domain/assistantCommands';
import { MenuPanel, MenuRow } from '../ui/MenuPanel';

/** Popover listing every command/action row matching the field's leading "/"
 *  text (typed path) or every command plus Add manually (opened
 *  from "+" — composer-seated-with-xavier-spec.md §4.4, row order pinned by
 *  `plusMenuRows` in assistantCommands.ts), plus a pinned "What can I ask?"
 *  row (unrelated to any filter, so it stays visible even when `rows` is
 *  empty — e.g. a typed "/x" that matches no command) opening
 *  AssistantExamplesSheet. Rendered as a sibling of the composer row (not the
 *  scroll view) so it rides with the row instead of scrolling away with the
 *  rest of the screen. */
export function SlashMenu({
  rows,
  onPick,
  onAddManually,
  onExamples,
}: {
  rows: PlusMenuRow[];
  onPick: (cmd: AssistantCommand) => void;
  onAddManually: () => void;
  onExamples: () => void;
}) {
  const c = useThemeColors();
  return (
    <View className="absolute left-0 right-0" style={{ bottom: '100%', marginBottom: 8 }}>
      {/* An in-flow sibling of the composer row with no entering animation —
          the one anchor style `panel` glass is allowed on (glass-standard-
          adoption-spec.md S6, style guide R9). */}
      <MenuPanel glass>
        {rows.map((row, i) => (
          <React.Fragment key={row === 'addManually' ? 'addManually' : row.name}>
            {i > 0 && <View style={{ height: 1, backgroundColor: c.border, marginHorizontal: 12 }} />}
            {row === 'addManually' ? (
              <MenuRow
                label="Add manually"
                icon={icons.keyboard}
                onPress={onAddManually}
                accessibilityLabel="Add manually"
              />
            ) : (
              <MenuRow label={row.name} subtitle={row.title} onPress={() => onPick(row)} accessibilityLabel={`Run ${row.name}`} />
            )}
          </React.Fragment>
        ))}
        {rows.length > 0 && <View style={{ height: 1, backgroundColor: c.border, marginHorizontal: 12 }} />}
        <MenuRow
          label="What can I ask?"
          subtitle="See examples — expenses, questions, accounts"
          trailing="chevron-right"
          onPress={onExamples}
          accessibilityLabel="What can I ask"
        />
      </MenuPanel>
    </View>
  );
}
