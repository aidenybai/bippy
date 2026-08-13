/** @type {import('detox').DetoxConfig} */
module.exports = {
  testRunner: {
    args: {
      $0: "jest",
      config: "tests/native/jest.config.cjs",
    },
    jest: {
      setupTimeout: 120_000,
    },
  },
  apps: {
    "ios.debug": {
      type: "ios.app",
      binaryPath: "../e2e-expo/ios/build/Build/Products/Debug-iphonesimulator/bippye2eexpo.app",
      build:
        "cd ../e2e-expo && npx expo prebuild --platform ios --clean && xcodebuild -workspace ios/bippye2eexpo.xcworkspace -scheme bippye2eexpo -configuration Debug -sdk iphonesimulator -derivedDataPath ios/build -quiet",
    },
    "android.debug": {
      type: "android.apk",
      binaryPath: "../e2e-expo/android/app/build/outputs/apk/debug/app-debug.apk",
      testBinaryPath:
        "../e2e-expo/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk",
      build:
        "cd ../e2e-expo && npx expo prebuild --platform android --clean && cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug -quiet",
    },
  },
  devices: {
    simulator: {
      type: "ios.simulator",
      device: { type: "iPhone 16" },
    },
    emulator: {
      type: "android.emulator",
      device: { avdName: "Pixel_7_API_34" },
    },
  },
  configurations: {
    "ios.sim.debug": {
      device: "simulator",
      app: "ios.debug",
    },
    "android.emu.debug": {
      device: "emulator",
      app: "android.debug",
    },
  },
};
