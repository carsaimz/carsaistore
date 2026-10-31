import type { Platform, SourceId } from '../core/models/AppItem';

export const ROTULO_PLATAFORMA: Record<Platform, string> = {
  android: 'Android',
  ios: 'iOS',
  desktop: 'Desktop',
};

export const ROTULO_FONTE: Record<SourceId, string> = {
  fdroid: 'F-Droid',
  github: 'GitHub',
  itunes: 'App Store',
  homebrew: 'Homebrew',
  flathub: 'Flathub',
  winget: 'Winget',
};
