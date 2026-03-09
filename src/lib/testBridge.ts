import {
  appPaths,
  exportProfile,
  listSessionLogs,
  listProfiles,
  importProfileFromOnboarding,
  importProfileFromRaw,
  profileRuntimeSnapshot,
  removeProfile,
  startProfileSession,
  stopSigner,
} from '@/lib/api';

declare global {
  interface Window {
    __IGLOO_HOME_TEST__?: {
      appPaths: typeof appPaths;
      listProfiles: typeof listProfiles;
      importProfileFromRaw: typeof importProfileFromRaw;
      importProfileFromOnboarding: typeof importProfileFromOnboarding;
      removeProfile: typeof removeProfile;
      exportProfile: typeof exportProfile;
      startProfileSession: typeof startProfileSession;
      profileRuntimeSnapshot: typeof profileRuntimeSnapshot;
      stopSigner: typeof stopSigner;
      listSessionLogs: typeof listSessionLogs;
    };
  }
}

export function installTestBridge() {
  window.__IGLOO_HOME_TEST__ = {
    appPaths,
    listProfiles,
    importProfileFromRaw,
    importProfileFromOnboarding,
    removeProfile,
    exportProfile,
    startProfileSession,
    profileRuntimeSnapshot,
    stopSigner,
    listSessionLogs,
  };
}
