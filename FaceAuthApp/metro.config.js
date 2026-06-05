const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // Allow bundling ONNX model files as assets
    assetExts: [
      ...getDefaultConfig(__dirname).resolver.assetExts,
      'onnx',
      'tflite',
      'bin',
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
