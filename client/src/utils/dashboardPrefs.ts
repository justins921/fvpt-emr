export type CardId = 'stats' | 'schedule' | 'quick_actions';

export interface CardPref {
  id: CardId;
  visible: boolean;
  order: number;
}

export interface DashboardPrefs {
  cards: CardPref[];
  accent_color: string;
  avatar: string | null;
}

export const CARD_LABELS: Record<CardId, string> = {
  stats: 'Stats overview',
  schedule: "Today's schedule",
  quick_actions: 'Quick actions',
};

export const DEFAULT_CARDS: CardPref[] = [
  { id: 'stats', visible: true, order: 0 },
  { id: 'schedule', visible: true, order: 1 },
  { id: 'quick_actions', visible: true, order: 2 },
];

export interface AccentPreset {
  id: string;
  name: string;
  /** Shades keyed like the Tailwind primary palette slots used by the sidebar */
  shades: Record<'200' | '300' | '400' | '700' | '800' | '900', string>;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    id: 'blue', name: 'Blue',
    shades: { 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' },
  },
  {
    id: 'emerald', name: 'Emerald',
    shades: { 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 700: '#047857', 800: '#065f46', 900: '#064e3b' },
  },
  {
    id: 'violet', name: 'Violet',
    shades: { 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95' },
  },
  {
    id: 'rose', name: 'Rose',
    shades: { 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 700: '#be123c', 800: '#9f1239', 900: '#881337' },
  },
  {
    id: 'amber', name: 'Amber',
    shades: { 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 700: '#b45309', 800: '#92400e', 900: '#78350f' },
  },
  {
    id: 'slate', name: 'Slate',
    shades: { 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 700: '#334155', 800: '#1e293b', 900: '#0f172a' },
  },
];

export const DEFAULT_PREFS: DashboardPrefs = {
  cards: DEFAULT_CARDS,
  accent_color: 'blue',
  avatar: null,
};

export function accentPreset(id: string | undefined | null): AccentPreset {
  return ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
}

/** CSS variable map for the sidebar accent overrides (see styles/index.css). */
export function accentCssVars(preset: AccentPreset): Record<string, string> {
  return {
    '--accent-200': preset.shades['200'],
    '--accent-300': preset.shades['300'],
    '--accent-400': preset.shades['400'],
    '--accent-700': preset.shades['700'],
    '--accent-800': preset.shades['800'],
    '--accent-900': preset.shades['900'],
  };
}

/** Downscale an image file to a max 256px JPEG data URL for avatar storage. */
export function processAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 256;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Image processing is not supported in this browser.'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
