/** @type {import('detox').DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: 'tests/native/jest.config.js',
    },
    jest: {
      setupTimeout: 120_000,
    },
  },
  apps: {
    'ios.debug': {
      type: 'ios.app',
      binaryPath:
        'fixtures/expo-app/ios/build/Build/Products/Debug-iphonesimulator/bippye2eexpo.app',
      build:
        'cd fixtures/expo-app && npx expo prebuild --platform ios --clean && xcodebuild -workspace ios/bippye2eexpo.xcworkspace -scheme bippye2eexpo -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build -quiet',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath:
        'fixtures/expo-app/android/app/build/outputs/apk/debug/app-debug.apk',
      build:
        'cd fixtures/expo-app && npx expo prebuild --platform android --clean && cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug -quiet',
    },
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: { type: 'iPhone 16' },
    },
    emulator: {
      type: 'android.emulator',
      device: { avdName: 'Pixel_7_API_34' },
    },
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.debug',
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.debug',
    },
  },
};
