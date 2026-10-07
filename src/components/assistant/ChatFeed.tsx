/**
 * The Assistant's chat feed (docs/design/xavier-daily-chat-spec.md §3, §6.2,
 * §6.3). A virtualised, bottom-anchored list of the day's messages; this file
 * only DRAWS the rows `buildFeedRows` (src/domain/chatFeed.ts) decides on.
 *
 * Bottom-anchored the cheap, robust way: an INVERTED FlatList. Offset 0 is the
 * newest end, so the newest message and the live card sit directly above the
 * composer whatever the keyboard does to the list's height, and
 * `maintainVisibleContentPosition` follows new messages only while the user is
 * already near the bottom (a user who scrolled up is left where they are, and
 * gets the "↓ New" pill instead). The tail (spinner, chips, ...) is the
 * inverted list's header, i.e. the last thing before the composer.
 *
 * Every size comes from `useScaledType()`; no new colours.
 */
import React, {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { FlatList, NativeScrollEvent, NativeSyntheticEvent, Pressable, Text, View } from 'react-native';
import { SpeechBubble } from './SpeechBubble';
import { AnswerCard } from './AnswerCard';
import { ComparisonCard } from './ComparisonCard';
import { radius } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import { useScaledType } from '../../theme/useScaledType';
import { isNearBottom } from '../../domain/chatFeed';
import { spokenText } from './announce';
import type { FeedRow } from '../../domain/chatFeed';
import type { ChatMessage } from '../../domain/chatMessage';
import type { BubbleContent } from '../../domain/bubbleCopy';

export interface ChatFeedHandle {
  /** Scrolls to the newest message (offset 0 of the inverted list). */
  scrollToNewest: (animated?: boolean) => void;
}

/** A stored Xavier message as the speech bubble's content. */
function bubbleOf(m: ChatMessage): BubbleContent | null {
  if (m.kind === 'xavier_text') return { kind: 'text', text: m.payload.text };
  if (m.kind === 'xavier_receipt') {
    const { headline, amountText, amountTone, lines, budget } = m.payload;
    return { kind: 'receipt', headline, amountText, amountTone, lines, budget };
  }
  return null;
}

const UserBubble = memo(function UserBubble({ message }: { message: ChatMessage }) {
  const s = useScaledType();
  const text =
    message.kind === 'user_text'
      ? message.payload.text
      : message.kind === 'user_photo'
        ? message.payload.label
        : '';
  return (
    <View
      accessible
      accessibilityLabel={`You: ${text}`}
      className="bg-primaryFill self-end"
      style={{
        maxWidth: '76%',
        paddingVertical: 10,
        paddingHorizontal: 15,
        borderRadius: radius.lg,
        borderBottomRightRadius: radius.sm,
      }}
    >
      <Text
        className="text-white font-medium"
        style={{
          fontSize: s.role.body,
          lineHeight: Math.round(s.role.body * 1.3),
        }}
      >
        {text}
      </Text>
    </View>
  );
});

/** Xavier's words: the speech bubble, feed variant, read as one element. */
const XavierBubble = memo(function XavierBubble({ message }: { message: ChatMessage }) {
  const s = useScaledType();
  const content = bubbleOf(message);
  if (!content) return null;
  return (
    <View
      accessible
      accessibilityLabel={`Xavier: ${spokenText(message) ?? ''}`}
      style={{ alignSelf: 'flex-start', maxWidth: '88%' }}
    >
      <SpeechBubble variant="feed" content={content} fontSize={s.role.body} maxWidth="100%" />
    </View>
  );
});

/** A card the user moved past: one dashed line in the kind's own wording. */
const StubRow = memo(function StubRow({ text }: { text: string }) {
  const c = useThemeColors();
  const s = useScaledType();
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      className="self-start"
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: c.border,
        borderRadius: radius.md,
        paddingVertical: 9,
        paddingHorizontal: 14,
      }}
    >
      <Text className="text-muted" style={{ fontSize: s.role.caption }}>
        {text}
      </Text>
    </View>
  );
});

/** A query answer kept as history: redrawn from its stored result, no buttons. */
const AnswerRow = memo(function AnswerRow({ message }: { message: ChatMessage }) {
  const s = useScaledType();
  if (message.kind !== 'query_answer') return null;
  const { tool, result, caption, comparison, currency } = message.payload;
  return comparison ? (
    <View style={{ gap: 6 }}>
      <ComparisonCard comparison={comparison} currency={currency} />
      {caption ? (
        <Text className="text-muted px-1" style={{ fontSize: s.role.caption }}>
          {caption}
        </Text>
      ) : null}
    </View>
  ) : (
    <AnswerCard tool={tool} result={result} currency={currency} caption={caption} />
  );
});

/** "New message": a new Xavier message arrived while the user was scrolled up. */
export function NewMessagesPill({ onPress }: { onPress: () => void }) {
  const s = useScaledType();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="New message, scroll to newest"
      className="bg-primaryFill rounded-pill items-center justify-center self-center"
      style={{
        position: 'absolute',
        bottom: 8,
        minHeight: Math.max(44, s.chipHeight),
        paddingHorizontal: 18,
      }}
    >
      <Text className="text-white font-bold" style={{ fontSize: s.role.control }}>
        ↓ New
      </Text>
    </Pressable>
  );
}

/** The screen's live card element. The live row reads it from here, so the list's
 *  `renderItem` stays stable and only the live row re-renders when the card changes. */
export const LiveSlotContext = createContext<React.ReactNode>(null);

function LiveRow() {
  const slot = useContext(LiveSlotContext);
  return <View style={{ alignSelf: 'stretch' }}>{slot}</View>;
}

export const ChatFeed = forwardRef<
  ChatFeedHandle,
  {
    /** Oldest first. Memoise it. */
    rows: FeedRow[];
    /** Spinner / chips / refusal actions: the last thing before the composer. */
    tail: React.ReactNode;
    /** The pill, drawn over the bottom edge when shown. */
    showNewPill: boolean;
    onNewPillPress: () => void;
    /** Fires when the list crosses into or out of "near the bottom". */
    onNearBottomChange: (near: boolean) => void;
    /** A drag or tap on empty feed space: close the keyboard and menus. */
    onBackgroundInteraction: () => void;
  }
>(function ChatFeed(
  {
    rows,
    tail,
    showNewPill,
    onNewPillPress,
    onNearBottomChange,
    onBackgroundInteraction,
  },
  ref,
) {
  const s = useScaledType();
  const listRef = useRef<FlatList<FeedRow>>(null);
  const nearRef = useRef(true);
  // Close enough to count as "at the bottom": about three lines of body text.
  const threshold = s.role.body * 3;

  useImperativeHandle(ref, () => ({
    scrollToNewest: (animated = true) => listRef.current?.scrollToOffset({ offset: 0, animated }),
  }));

  // Inverted lists want newest first.
  const data = useMemo(() => [...rows].reverse(), [rows]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const near = isNearBottom(e.nativeEvent.contentOffset.y, threshold);
      if (near !== nearRef.current) {
        nearRef.current = near;
        onNearBottomChange(near);
      }
    },
    [threshold, onNearBottomChange],
  );

  const renderItem = useCallback(
    ({ item }: { item: FeedRow }) => {
      switch (item.type) {
        case 'user':
          return <UserBubble message={item.message} />;
        case 'xavier':
          return <XavierBubble message={item.message} />;
        case 'answer':
          return <AnswerRow message={item.message} />;
        case 'stub':
          return <StubRow text={item.text} />;
        case 'live':
          return <LiveRow />;
      }
    },
    [],
  );

  return (
    // A tap on empty feed space closes the "+" and photo menus and the keyboard
    // (composer spec §4.4); rows that handle their own taps claim them first.
    <Pressable
      accessible={false}
      onPress={onBackgroundInteraction}
      style={{ flex: 1, marginHorizontal: -s.screenPadding }}
    >
      {/* The list spans the full width (the screen's own padding is undone) so
          shadows are not clipped; its content is inset to match the mock. */}
      <FlatList
        ref={listRef}
        inverted
        data={data}
        keyExtractor={(row) => row.key}
        renderItem={renderItem}
        ItemSeparatorComponent={Gap}
        ListHeaderComponent={<View>{tail}</View>}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={onBackgroundInteraction}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: threshold,
        }}
        contentContainerStyle={{
          paddingVertical: 8,
          paddingHorizontal: s.screenPadding - 8,
        }}
        // Rows are not clipped away: the live card holds inputs and menus that must stay mounted.
        removeClippedSubviews={false}
      />
      {showNewPill && <NewMessagesPill onPress={onNewPillPress} />}
    </Pressable>
  );
});

function Gap() {
  return <View style={{ height: 10 }} />;
}

