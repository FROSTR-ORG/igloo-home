import {
  appPaths,
  connectOnboardingPackage,
  discardConnectedOnboarding,
  finalizeConnectedOnboarding,
  listSessionLogs,
  listProfiles,
  importProfileFromOnboarding,
  importProfileFromRaw,
  profileRuntimeSnapshot,
  refreshRuntimePeers,
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
      connectOnboardingPackage: typeof connectOnboardingPackage;
      finalizeConnectedOnboarding: typeof finalizeConnectedOnboarding;
      discardConnectedOnboarding: typeof discardConnectedOnboarding;
      removeProfile: typeof removeProfile;
      startProfileSession: typeof startProfileSession;
      profileRuntimeSnapshot: typeof profileRuntimeSnapshot;
      refreshRuntimePeers: typeof refreshRuntimePeers;
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
    connectOnboardingPackage,
    finalizeConnectedOnboarding,
    discardConnectedOnboarding,
    removeProfile,
    startProfileSession,
    profileRuntimeSnapshot,
    refreshRuntimePeers,
    stopSigner,
    listSessionLogs,
  };
}
