export default ({ config }) => ({
  ...config,
  name: "GapptoMobile V3",
  slug: "gapptomobile-v3",
  scheme: "gapptomobilev3",
  plugins: ["expo-secure-store"],

  ios: {
    ...config.ios,
    bundleIdentifier: "com.sesiom27.gapptomobilev3",
    supportsTablet: false
  },

  android: {
    ...config.android,
    package: "com.sesiom27.gapptomobilev3"
  },

  updates: {
    url: "https://u.expo.dev/bb4c48e3-397b-498c-97d9-16c8f5ddf747"
  },

  runtimeVersion: {
    policy: "appVersion"
  },

  extra: {
    eas: {
      projectId: "bb4c48e3-397b-498c-97d9-16c8f5ddf747"
    },
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL
  }
});
