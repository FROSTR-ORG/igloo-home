/** @type {import('tailwindcss').Config} */
import iglooPreset from 'igloo-ui/tailwind.preset';

export default {
  presets: [iglooPreset],
  content: ['./src/**/*.{ts,tsx}', '../igloo-ui/src/**/*.{ts,tsx}'],
};
