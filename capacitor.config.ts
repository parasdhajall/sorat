import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sorat.agentpos',
  appName: 'Sorat POS',
  webDir: '.output/public',
  server: {
    url: 'https://sorat.vercel.app',
    cleartext: true
  }
};

export default config;

