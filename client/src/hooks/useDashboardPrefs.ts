import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../services/api';
import {
  DashboardPrefs,
  DEFAULT_PREFS,
  CARD_LABELS,
  CardId,
} from '../utils/dashboardPrefs';

function unwrap(res: any) {
  if (!res) return {};
  return res.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : res;
}

function normalize(raw: any): DashboardPrefs {
  const data = unwrap(raw);
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const byId = new Map<CardId, { visible?: unknown; order?: unknown }>(
    cards
      .filter((c: any) => c && typeof c === 'object' && c.id in CARD_LABELS)
      .map((c: any) => [c.id as CardId, { visible: c.visible, order: c.order }])
  );
  const ordered = (Object.keys(CARD_LABELS) as CardId[]).map((id, i) => {
    const c = byId.get(id);
    return {
      id,
      visible: c?.visible !== false,
      order: Number.isInteger(c?.order) ? (c!.order as number) : i,
    };
  }).sort((a, b) => a.order - b.order);
  return {
    cards: ordered,
    accent_color: typeof data.accent_color === 'string' ? data.accent_color : 'blue',
    avatar: typeof data.avatar === 'string' && data.avatar.startsWith('data:image/') ? data.avatar : null,
  };
}

interface StoreState {
  prefs: DashboardPrefs;
  loaded: boolean;
}

let state: StoreState = { prefs: DEFAULT_PREFS, loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

async function load(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await api.get<any>('/users/me/dashboard');
      state = { prefs: normalize(res), loaded: true };
    } catch {
      // Fall back to defaults (e.g. endpoint unavailable); dashboard still works
      state = { prefs: DEFAULT_PREFS, loaded: true };
    } finally {
      inflight = null;
      emit();
    }
  })();
  return inflight;
}

export function useDashboardPrefs() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => state
  );

  useEffect(() => {
    if (!snap.loaded) load();
  }, [snap.loaded]);

  async function save(prefs: DashboardPrefs): Promise<DashboardPrefs> {
    const res = await api.put<any>('/users/me/dashboard', prefs);
    const next = normalize(res);
    state = { prefs: next, loaded: true };
    emit();
    return next;
  }

  return { prefs: snap.prefs, loaded: snap.loaded, save, reload: load };
}
