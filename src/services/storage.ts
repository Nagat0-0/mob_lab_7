import type { RadioStation } from '../types';

const PRESETS_KEY = 'wt_presets_v1';
const FAVORITES_KEY = 'wt_favorites_v1';
const HISTORY_KEY = 'wt_history_v1';
const LAST_STATION_KEY = 'wt_last_station_v1';

const PRESET_COUNT = 6;
const HISTORY_LIMIT = 20;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

export function getPresets(): (RadioStation | null)[] {
  const stored = readJson<(RadioStation | null)[]>(PRESETS_KEY, []);
  const slots: (RadioStation | null)[] = [];
  for (let i = 0; i < PRESET_COUNT; i++) {
    slots.push(stored[i] ?? null);
  }
  return slots;
}

export function setPreset(index: number, station: RadioStation | null): (RadioStation | null)[] {
  const slots = getPresets();
  if (index >= 0 && index < PRESET_COUNT) {
    slots[index] = station;
    writeJson(PRESETS_KEY, slots);
  }
  return slots;
}

export function getFavorites(): RadioStation[] {
  return readJson<RadioStation[]>(FAVORITES_KEY, []);
}

export function isFavorite(stationuuid: string): boolean {
  return getFavorites().some((item) => item.stationuuid === stationuuid);
}

export function toggleFavorite(station: RadioStation): boolean {
  const list = getFavorites();
  const existsIndex = list.findIndex((item) => item.stationuuid === station.stationuuid);

  if (existsIndex >= 0) {
    list.splice(existsIndex, 1);
    writeJson(FAVORITES_KEY, list);
    return false;
  }

  list.unshift(station);
  writeJson(FAVORITES_KEY, list);
  return true;
}

export function getHistory(): RadioStation[] {
  return readJson<RadioStation[]>(HISTORY_KEY, []);
}

export function addToHistory(station: RadioStation): RadioStation[] {
  const list = getHistory().filter((item) => item.stationuuid !== station.stationuuid);
  list.unshift(station);
  const trimmed = list.slice(0, HISTORY_LIMIT);
  writeJson(HISTORY_KEY, trimmed);
  return trimmed;
}

export function clearHistory(): void {
  writeJson(HISTORY_KEY, []);
}

export function getLastStation(): RadioStation | null {
  return readJson<RadioStation | null>(LAST_STATION_KEY, null);
}

export function setLastStation(station: RadioStation): void {
  writeJson(LAST_STATION_KEY, station);
}