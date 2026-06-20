/**
 * Avatar component. Renders a DiceBear SVG today; if an `image` source is
 * supplied (e.g. custom AI-generated art) it renders that instead — the rest of
 * the app is unaffected because it only references `AvatarSource`.
 */
import React, { useMemo } from 'react';
import { Image } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { createAvatar } from '@dicebear/core';
import { funEmoji, bottts, adventurer } from '@dicebear/collection';
import { AvatarSource, DicebearStyle } from '../theme/assets';

const styleMap = { funEmoji, bottts, adventurer };

function svgFor(style: DicebearStyle, seed: string): string {
  return createAvatar(styleMap[style], { seed }).toString();
}

export function Avatar({
  source,
  size = 120,
}: {
  source: AvatarSource;
  size?: number;
}) {
  const xml = useMemo(
    () => (source.kind === 'dicebear' ? svgFor(source.style, source.seed) : null),
    [source]
  );

  if (source.kind === 'image') {
    return (
      <Image
        source={{ uri: source.uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return <SvgXml xml={xml!} width={size} height={size} />;
}
