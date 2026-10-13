const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withProjectBuildGradle,
} = require("expo/config-plugins");

const withDetoxAndroid = (config) => {
  const androidPackage = config.android?.package;
  if (!androidPackage) throw new Error("Detox Android requires expo.android.package");

  config = withProjectBuildGradle(config, (projectConfig) => {
    const detoxPackageDirectory = path.dirname(
      require.resolve("detox/package.json", { paths: [projectConfig.modRequest.projectRoot] }),
    );
    const detoxRepositoryDirectory = path
      .relative(
        projectConfig.modRequest.platformProjectRoot,
        path.join(detoxPackageDirectory, "Detox-android"),
      )
      .split(path.sep)
      .join("/");
    const repositoryDeclaration = `maven { url("$rootDir/${detoxRepositoryDirectory}") }`;
    if (!projectConfig.modResults.contents.includes(repositoryDeclaration)) {
      projectConfig.modResults.contents = projectConfig.modResults.contents.replace(
        /allprojects\s*\{\s*repositories\s*\{/,
        (repositoriesBlock) => `${repositoriesBlock}\n    ${repositoryDeclaration}`,
      );
    }
    return projectConfig;
  });

  config = withAppBuildGradle(config, (appConfig) => {
    const instrumentationDeclaration =
      "testInstrumentationRunner 'androidx.test.runner.AndroidJUnitRunner'";
    const buildTypeDeclaration = "testBuildType System.getProperty('testBuildType', 'debug')";
    const detoxDependency = "androidTestImplementation('com.wix:detox:+')";
    if (!appConfig.modResults.contents.includes(instrumentationDeclaration)) {
      appConfig.modResults.contents = appConfig.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (defaultConfigBlock) =>
          `${defaultConfigBlock}\n        ${buildTypeDeclaration}\n        ${instrumentationDeclaration}`,
      );
    }
    if (!appConfig.modResults.contents.includes(detoxDependency)) {
      appConfig.modResults.contents = appConfig.modResults.contents.replace(
        /dependencies\s*\{/,
        (dependenciesBlock) => `${dependenciesBlock}\n    ${detoxDependency}`,
      );
    }
    return appConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifestConfig.modResults);
    application.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    return manifestConfig;
  });

  config = withDangerousMod(config, [
    "android",
    async (androidConfig) => {
      const androidProjectDirectory = androidConfig.modRequest.platformProjectRoot;
      const androidPackageDirectory = androidPackage.split(".").join(path.sep);
      const testSourceDirectory = path.join(
        androidProjectDirectory,
        "app/src/androidTest/java",
        androidPackageDirectory,
      );
      const resourceDirectory = path.join(androidProjectDirectory, "app/src/main/res/xml");
      const detoxTest = `package ${androidPackage};

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.rule.ActivityTestRule;
import com.wix.detox.Detox;
import com.wix.detox.config.DetoxConfig;
import org.junit.Rule;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@LargeTest
public class DetoxTest {
    @Rule
    public ActivityTestRule<MainActivity> activityRule = new ActivityTestRule<>(MainActivity.class, false, false);

    @Test
    public void runDetoxTests() {
        DetoxConfig detoxConfig = new DetoxConfig();
        detoxConfig.idlePolicyConfig.masterTimeoutSec = 90;
        detoxConfig.idlePolicyConfig.idleResourceTimeoutSec = 60;
        detoxConfig.rnContextLoadTimeoutSec = BuildConfig.DEBUG ? 180 : 60;
        Detox.runTests(activityRule, detoxConfig);
    }
}
`;
      const networkSecurityConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
</network-security-config>
`;
      await Promise.all([
        mkdir(testSourceDirectory, { recursive: true }),
        mkdir(resourceDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(testSourceDirectory, "DetoxTest.java"), detoxTest),
        writeFile(
          path.join(resourceDirectory, "network_security_config.xml"),
          networkSecurityConfig,
        ),
      ]);
      return androidConfig;
    },
  ]);

  return config;
};

module.exports = withDetoxAndroid;
