/**
 * Xavier's speech bubble (docs/design/xavier-speech-bubble-spec.md §3): every
 * line he says on the Assistant, under the avatar with the tail pointing up at
 * him. Thin on purpose - the words and numbers come from `BubbleContent`
 * (src/domain/bubbleCopy.ts). One accessibility element whose label is the
 * full text; touches pass through so a tap still dismisses the keyboard.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { BudgetBar } from '../ui/BudgetBar';
import { warnColor } from '../ui/StatusChip';
import { useThemeColors } from '../../theme/useThemeColors';
import { radius, typography } from '../../theme/tokens';
import { bubbleText } from '../../domain/bubbleCopy';
import type { BubbleBudget, BubbleContent } from '../../domain/bubbleCopy';

const TABULAR = { fontVariant: ['tabular-nums' as const] };
const TAIL = 14;

export function SpeechBubble({
  content,
  fontSize,
  maxWidth = 300,
}: {
  content: BubbleContent;
  /** The main line's size: `s.role.body`, or `s.role.prompt` during the /account Q&A. */
  fontSize: number;
  maxWidth?: number;
}) {
  const c = useThemeColors();
  const main = { fontSize, lineHeight: Math.round(fontSize * 1.3) };
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel={bubbleText(content)}
      style={{
        marginTop: 16,
        maxWidth,
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.borderAccent,
        borderRadius: radius.lg,
        paddingTop: 11,
        paddingHorizontal: 14,
        paddingBottom: 12,
        ...c.elevation.raised,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: -(TAIL / 2 + 1),
          left: '50%',
          marginLeft: -TAIL / 2,
          width: TAIL,
          height: TAIL,
          backgroundColor: c.surface,
          borderLeftWidth: 1,
          borderTopWidth: 1,
          borderColor: c.borderAccent,
          borderTopLeftRadius: radius.xs,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {content.kind === 'text' ? (
        <Text className="text-text text-center font-bold" style={main}>
          {content.text}
        </Text>
      ) : (
        <Receipt content={content} main={main} />
      )}
    </View>
  );
}

function Receipt({
  content,
  main,
}: {
  content: Extract<BubbleContent, { kind: 'receipt' }>;
  main: { fontSize: number; lineHeight: number };
}) {
  const c = useThemeColors();
  const { headline, amountText, amountTone, lines, budget } = content;
  const at = amountText ? headline.indexOf(amountText) : -1;
  const tone = amountTone === 'positive' ? c.positive : amountTone === 'negative' ? c.negative : undefined;
  return (
    <View>
      <Text className="text-text font-bold" style={main}>
        {at < 0 ? (
          headline
        ) : (
          <>
            {headline.slice(0, at)}
            <Text style={[TABULAR, tone ? { color: tone } : null]}>{amountText}</Text>
            {headline.slice(at + (amountText?.length ?? 0))}
          </>
        )}
      </Text>
      {lines.map((line) => (
        <Text
          key={line}
          className="text-muted"
          style={{ fontSize: typography.caption, marginTop: 3 }}
        >
          {line}
        </Text>
      ))}
      {budget && <BudgetLine budget={budget} />}
    </View>
  );
}

function BudgetLine({ budget }: { budget: BubbleBudget }) {
  const c = useThemeColors();
  const color =
    budget.state === 'over' ? c.negative : budget.state === 'warn' ? warnColor(c) : c.positive;
  // "SGD 25 left" is the bold, coloured part; "in Food this month" follows.
  return (
    <View>
      <BudgetBar
        budget={100}
        spent={budget.usedRatio * 100}
        state={budget.state}
        thin
        style={{ marginTop: 9 }}
      />
      <Text className="text-muted" style={{ fontSize: typography.caption, marginTop: 6 }}>
        <Text className="font-bold" style={[TABULAR, { color }]}>
          {budget.amountText} {budget.verb}
        </Text>
        {` ${budget.where}`}
      </Text>
    </View>
  );
}
