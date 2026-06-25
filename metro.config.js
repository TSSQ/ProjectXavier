// Metro config wrapped with NativeWind so Tailwind classes compile.
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
/* eslint-enable @typescript-eslint/no-require-imports */

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
