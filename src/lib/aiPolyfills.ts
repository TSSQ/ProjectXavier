/**
 * Runtime polyfills required by the Vercel AI SDK (`ai`) on React Native /
 * Hermes: structuredClone and the web-streams family (TransformStream,
 * ReadableStream, WritableStream, TextEncoder/DecoderStream) don't exist
 * there. Follows the setup documented by @react-native-ai
 * (https://react-native-ai.dev → docs/polyfills); imported for its side
 * effects at the very top of app/_layout.tsx, before anything that touches
 * the AI SDK (src/features/ai/deviceParse.ts).
 */
import { Platform } from 'react-native';
import structuredClone from '@ungap/structured-clone';
import {
  TransformStream,
  ReadableStream,
  WritableStream,
} from 'web-streams-polyfill';

if (Platform.OS !== 'web') {
  const setupPolyfills = async () => {
    const { polyfillGlobal } = await import(
      'react-native/Libraries/Utilities/PolyfillFunctions'
    );

    const { TextEncoderStream, TextDecoderStream } = await import(
      '@stardazed/streams-text-encoding'
    );

    if (!('structuredClone' in global)) {
      polyfillGlobal('structuredClone', () => structuredClone);
    }
    if (!('TransformStream' in global)) {
      polyfillGlobal('TransformStream', () => TransformStream);
    }
    if (!('ReadableStream' in global)) {
      polyfillGlobal('ReadableStream', () => ReadableStream);
    }
    if (!('WritableStream' in global)) {
      polyfillGlobal('WritableStream', () => WritableStream);
    }
    if (!('TextEncoderStream' in global)) {
      polyfillGlobal('TextEncoderStream', () => TextEncoderStream);
    }
    if (!('TextDecoderStream' in global)) {
      polyfillGlobal('TextDecoderStream', () => TextDecoderStream);
    }
  };

  setupPolyfills();
}

export {};
