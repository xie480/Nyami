const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  // react-native 0.74 does not expose TextEncoder to QRCode's encoder by default.
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-qrcode-svg/textEncodingTransformation',
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
