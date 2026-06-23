import {
  WelcomeEntryHero,
  WelcomeReturningHero,
  type WelcomeReturningProfileModel,
} from 'igloo-ui';

export default function LandingPage({
  logoSrc,
  profiles,
  onCreate,
  onLoad,
  onOnboard,
  onUnlock,
  onRotate,
  onRecover,
  onDelete,
}: {
  logoSrc: string;
  profiles: WelcomeReturningProfileModel[];
  onCreate: () => void;
  onLoad: () => void;
  onOnboard: () => void;
  onUnlock: (profileId: string) => void;
  onRotate: (profileId: string) => void;
  onRecover: (profileId: string) => void;
  onDelete: (profileId: string) => void;
}) {
  if (profiles.length === 0) {
    return (
      <WelcomeEntryHero
        logoSrc={logoSrc}
        productLabel="Igloo Home"
        tagline="Threshold signing for your desktop."
        primaryAction={{
          heading: 'Create / Rotate Keyset',
          description: 'Generate new share material or rotate an existing keyset, save one local desktop device, and distribute the remaining shares.',
          buttonLabel: 'Start',
          onAction: onCreate,
        }}
        secondaryActions={[
          { id: 'load', label: 'Load Profile', onAction: onLoad },
          { id: 'onboard', label: 'Onboard Device', onAction: onOnboard },
        ]}
      />
    );
  }

  return (
    <WelcomeReturningHero
      logoSrc={logoSrc}
      productLabel="Igloo Home"
      layout={profiles.length === 1 ? 'single' : profiles.length <= 3 ? 'multi' : 'many'}
      profiles={profiles}
      onUnlock={onUnlock}
      onRotate={onRotate}
      onRecover={onRecover}
      onDelete={onDelete}
      secondaryActions={[
        { id: 'load', label: 'Load Profile', onAction: onLoad },
        { id: 'onboard', label: 'Onboard Device', onAction: onOnboard },
      ]}
    />
  );
}
