/** @type {import('jest').Config} */
module.exports = {
  rootDir: "../..",
  testMatch: ["<rootDir>/tests/native/**/*.spec.ts"],
  // first launch on a cold CI simulator takes ~100s of dyld work plus a
  // ~15s initial Metro bundle; hooks share this budget
  testTimeout: 300_000,
  maxWorkers: 1,
  globalSetup: "detox/runners/jest/globalSetup",
  globalTeardown: "detox/runners/jest/globalTeardown",
  reporters: ["detox/runners/jest/reporter"],
  testEnvironment: "detox/runners/jest/testEnvironment",
  verbose: true,
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
};
