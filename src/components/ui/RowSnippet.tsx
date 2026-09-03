/**
 * RowSnippet — the strip of the scanned photo a draft card's amount was read
 * from (docs/design/row-snippet-spec.md). Clips and translates a plain RN
 * `Image`: no crop, no async work, no temp file, no new dependency (D3).
 *
 * A thin renderer only (§4.4a, D5) — all the window arithmetic (padding,
 * scaling, and the amount-anchored bottom-align when the band is taller
 * than the strip) lives in `computeSnippetWindow` (src/domain/
 * snippetWindow.ts), a framework-free module the plain-Node BDD suite can
 * test directly. This component just reads `containerWidth` from onLayout
 * and renders whatever that function returns.
 *
 * The only file in the domain/review-flow that imports from react-native —
 * `SourceBand`/`LayoutRow`/`TransactionDraft`/`computeSnippetWindow` stay
 * framework-free so the BDD suite can keep testing them in plain Node.
 */
import React, { useState } from 'react';
import { Image, LayoutChangeEvent, View } from 'react-native';
import { SourceBand } from '../../domain/statementLayout';
import { computeSnippetWindow } from '../../domain/snippetWindow';

/** Container is capped at this height so a tall multi-line block can't
 *  dominate the card (row-snippet-spec.md §4.4). */
const MAX_HEIGHT = 96;

export interface RowSnippetProps {
  /** The row/receiptTotal band this card's amount came from. */
  band: SourceBand;
  /** The band of just the line carrying the amount — must stay visible;
   *  see computeSnippetWindow. */
  amountBand: SourceBand;
  /** The scanned photo: uri plus its PIXEL dimensions (from the picker
   *  asset). Missing/zero dimensions (some HEIC/iCloud assets) render
   *  nothing rather than a distorted strip. */
  image: { uri: string; width: number; height: number };
}

export function RowSnippet({ band, amountBand, image }: RowSnippetProps) {
  const [containerWidth, setContainerWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width);

  // containerWidth is only known after the first onLayout — render just the
  // (invisible, zero-content) measuring container until then, so the strip
  // never renders at the WRONG width for a frame (computeSnippetWindow
  // itself would also return null for containerWidth 0, but we still need a
  // mounted View to ever receive that first onLayout).
  if (containerWidth === 0) {
    return <View onLayout={onLayout} style={{ maxHeight: MAX_HEIGHT }} />;
  }

  const window = computeSnippetWindow({ band, amountBand, containerWidth, image, maxHeight: MAX_HEIGHT });
  if (!window) return null;

  return (
    <View
      onLayout={onLayout}
      accessible
      accessibilityRole="image"
      accessibilityLabel="The part of the photo this was read from"
      className="rounded-md border border-border overflow-hidden mb-2"
      style={{ height: window.height, maxHeight: MAX_HEIGHT }}
    >
      <Image
        source={{ uri: image.uri }}
        accessible={false}
        style={{
          width: window.dispW,
          height: window.dispH,
          transform: [
            { translateX: window.translateX },
            { translateY: window.translateY },
          ],
        }}
      />
    </View>
  );
}
