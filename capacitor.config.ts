import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mz.carsai.store',
  appName: 'Carsai Store',
  webDir: 'dist',
  // Vários binários (APK/EXE) ainda são servidos via http; permitimos conteúdo
  // misto no WebView para que o FileTransfer consiga baixá-los.
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'always',
  },
  // Faz o fetch() do WebView passar pela camada nativa: contorna CORS de
  // fontes que não enviam Access-Control-Allow-Origin (ex.: F-Droid).
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
