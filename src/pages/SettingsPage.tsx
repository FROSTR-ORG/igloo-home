import { DesktopSettingsPanel } from 'igloo-ui';

import type { AppSettings } from '@/lib/types';

type Props = {
  settings: AppSettings;
  onToggle: (field: keyof AppSettings, checked: boolean) => void;
};

export default function SettingsPage({ settings, onToggle }: Props) {
  return <DesktopSettingsPanel settings={settings} onToggle={onToggle} />;
}
