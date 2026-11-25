import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.worldtuner.app',
  appName: 'WorldTuner',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;