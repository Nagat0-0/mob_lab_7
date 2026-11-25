import type { CountryOption, ExploreFilter, RadioStation, TagOption } from '../types';

interface RawStation {
  stationuuid?: string;
  name?: string;
  url_resolved?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  bitrate?: number;
  codec?: string;
  votes?: number;
  lastcheckok?: number;
}

interface RawCountry {
  name?: string;
  iso_3166_1?: string;
  stationcount?: number;
}

interface RawTag {
  name?: string;
  stationcount?: number;
}

const API_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info'
];

const BLOCKED_COUNTRY_CODES = new Set(['RU']);
const SUPPORTED_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'MP4']);

let activeMirrorIndex = 0;
let cachedCountries: CountryOption[] | null = null;
let cachedTags: TagOption[] | null = null;

function isBlockedLocation(code: string, countryName: string, url?: string): boolean {
  const upperCode = code.trim().toUpperCase();
  if (BLOCKED_COUNTRY_CODES.has(upperCode)) {
    return true;
  }

  const lowerName = countryName.trim().toLowerCase();
  if (lowerName.includes('russia')) {
    return true;
  }

  if (url) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.endsWith('.ru') || hostname.endsWith('.su')) {
        return true;
      }
    } catch {
    }
  }

  return false;
}

async function fetchFromMirrors<T>(path: string): Promise<T> {
  let lastError = 'Radio directory unavailable';

  for (let i = 0; i < API_MIRRORS.length; i++) {
    const idx = (activeMirrorIndex + i) % API_MIRRORS.length;
    const baseUrl = API_MIRRORS[idx];
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as T;
      activeMirrorIndex = idx;
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Network error';
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

function isIosCompatibleStream(raw: RawStation): boolean {
  const url = raw.url_resolved?.trim() ?? '';
  if (!url.startsWith('https://')) {
    return false;
  }

  if (raw.lastcheckok === 0) {
    return false;
  }

  if (isBlockedLocation(raw.countrycode ?? '', raw.country ?? '', url)) {
    return false;
  }

  const codec = (raw.codec ?? '').trim().toUpperCase();
  if (codec && !SUPPORTED_CODECS.has(codec)) {
    return false;
  }

  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.endsWith('.ogg') ||
    lowerUrl.endsWith('.opus') ||
    lowerUrl.endsWith('.flac') ||
    lowerUrl.endsWith('.pls')
  ) {
    return false;
  }

  return true;
}

function sanitizeStations(items: RawStation[]): RadioStation[] {
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const result: RadioStation[] = [];

  for (const raw of items) {
    const name = (raw.name ?? '').replace(/\s+/g, ' ').trim();
    const url = (raw.url_resolved ?? '').trim();
    const uuid = (raw.stationuuid ?? '').trim();

    if (!uuid || !name || !isIosCompatibleStream(raw)) {
      continue;
    }

    const nameKey = name.toLowerCase();
    if (seenUrls.has(url) || seenNames.has(nameKey)) {
      continue;
    }

    seenUrls.add(url);
    seenNames.add(nameKey);

    result.push({
      stationuuid: uuid,
      name,
      url_resolved: url,
      favicon: (raw.favicon ?? '').trim(),
      tags: (raw.tags ?? '').trim(),
      country: (raw.country ?? 'Global').trim() || 'Global',
      countrycode: (raw.countrycode ?? '').trim().toUpperCase(),
      bitrate: Number(raw.bitrate ?? 0),
      codec: (raw.codec ?? 'MP3').trim().toUpperCase() || 'MP3',
      votes: Number(raw.votes ?? 0)
    });
  }

  return result;
}

async function fetchSingleSearch(options: {
  query?: string;
  tag?: string;
  countryCode?: string;
  limit: number;
}): Promise<RawStation[]> {
  const params = new URLSearchParams({
    limit: String(options.limit),
    hidebroken: 'true',
    is_https: 'true',
    order: 'votes',
    reverse: 'true'
  });

  if (options.query?.trim()) {
    params.set('name', options.query.trim());
  }

  if (options.tag?.trim()) {
    params.set('tag', options.tag.trim().toLowerCase());
  }

  if (options.countryCode?.trim()) {
    params.set('countrycode', options.countryCode.trim().toUpperCase());
  }

  return fetchFromMirrors<RawStation[]>(`/json/stations/search?${params.toString()}`);
}

export async function searchStations(filter: ExploreFilter, limit = 45): Promise<RadioStation[]> {
  const query = filter.query.trim();
  const countries = filter.countryCodes
    .map((c) => c.trim().toUpperCase())
    .filter((c) => Boolean(c) && !BLOCKED_COUNTRY_CODES.has(c));
  const tags = filter.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);

  if (countries.length === 0 && tags.length === 0) {
    const raw = await fetchSingleSearch({ query, limit: limit * 2 });
    return sanitizeStations(raw).slice(0, limit);
  }

  if (countries.length > 0 && tags.length === 0) {
    const selected = countries.slice(0, 8);
    const perLimit = Math.max(25, Math.ceil((limit * 2) / selected.length));
    const batches = await Promise.all(
      selected.map((countryCode) => fetchSingleSearch({ query, countryCode, limit: perLimit }).catch(() => []))
    );
    return sanitizeStations(batches.flat())
      .sort((a, b) => b.votes - a.votes)
      .slice(0, limit);
  }

  if (countries.length === 0 && tags.length > 0) {
    const selected = tags.slice(0, 8);
    const perLimit = Math.max(25, Math.ceil((limit * 2) / selected.length));
    const batches = await Promise.all(
      selected.map((tag) => fetchSingleSearch({ query, tag, limit: perLimit }).catch(() => []))
    );
    return sanitizeStations(batches.flat())
      .sort((a, b) => b.votes - a.votes)
      .slice(0, limit);
  }

  if (countries.length * tags.length <= 8) {
    const tasks: Promise<RawStation[]>[] = [];
    for (const countryCode of countries) {
      for (const tag of tags) {
        tasks.push(fetchSingleSearch({ query, countryCode, tag, limit: 35 }).catch(() => []));
      }
    }
    const batches = await Promise.all(tasks);
    return sanitizeStations(batches.flat())
      .sort((a, b) => b.votes - a.votes)
      .slice(0, limit);
  }

  const selectedCountries = countries.slice(0, 8);
  const batches = await Promise.all(
    selectedCountries.map((countryCode) => fetchSingleSearch({ query, countryCode, limit: 120 }).catch(() => []))
  );

  const combined = sanitizeStations(batches.flat()).filter((station) => {
    const stationTags = station.tags
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    return tags.some((target) => stationTags.some((st) => st === target || st.includes(target)));
  });

  return combined.sort((a, b) => b.votes - a.votes).slice(0, limit);
}

export async function getFeaturedStations(limit = 35): Promise<RadioStation[]> {
  const params = new URLSearchParams({
    limit: String(limit * 2),
    hidebroken: 'true',
    is_https: 'true',
    order: 'clickcount',
    reverse: 'true'
  });

  const raw = await fetchFromMirrors<RawStation[]>(`/json/stations/search?${params.toString()}`);
  return sanitizeStations(raw).slice(0, limit);
}

export async function getAllCountries(): Promise<CountryOption[]> {
  if (cachedCountries) {
    return cachedCountries;
  }

  const raw = await fetchFromMirrors<RawCountry[]>('/json/countries?order=stationcount&reverse=true&hidebroken=true');
  const map = new Map<string, CountryOption>();

  for (const item of raw) {
    const code = (item.iso_3166_1 ?? '').trim().toUpperCase();
    const name = (item.name ?? '').trim();
    const count = Number(item.stationcount ?? 0);

    if (!/^[A-Z]{2}$/.test(code) || !name || count <= 0 || isBlockedLocation(code, name)) {
      continue;
    }

    const existing = map.get(code);
    if (existing) {
      existing.stationcount += count;
    } else {
      map.set(code, { code, name, stationcount: count });
    }
  }

  cachedCountries = Array.from(map.values()).sort((a, b) => b.stationcount - a.stationcount);
  return cachedCountries;
}

export async function getAllTags(): Promise<TagOption[]> {
  if (cachedTags) {
    return cachedTags;
  }

  const raw = await fetchFromMirrors<RawTag[]>(
    '/json/tags?order=stationcount&reverse=true&hidebroken=true&limit=250'
  );
  const map = new Map<string, TagOption>();

  for (const item of raw) {
    const name = (item.name ?? '').trim().toLowerCase();
    const count = Number(item.stationcount ?? 0);

    if (name.length < 2 || name.length > 28 || count < 3 || name.includes('russia')) {
      continue;
    }

    if (!map.has(name)) {
      map.set(name, { name, stationcount: count });
    }
  }

  cachedTags = Array.from(map.values()).sort((a, b) => b.stationcount - a.stationcount);
  return cachedTags;
}

export async function teleportStation(excludeUuid?: string): Promise<RadioStation | null> {
  try {
    const countries = await getAllCountries();
    const pool = countries.filter((c) => c.stationcount >= 3);
    const source = pool.length > 0 ? pool : countries;
    const shuffled = [...source].sort(() => Math.random() - 0.5);

    for (let attempt = 0; attempt < Math.min(4, shuffled.length); attempt++) {
      const randomCountry = shuffled[attempt];
      const params = new URLSearchParams({
        countrycode: randomCountry.code,
        limit: '30',
        hidebroken: 'true',
        is_https: 'true',
        order: 'random'
      });

      try {
        const raw = await fetchFromMirrors<RawStation[]>(`/json/stations/search?${params.toString()}`);
        const valid = sanitizeStations(raw).filter((s) => s.stationuuid !== excludeUuid);
        if (valid.length > 0) {
          return valid[Math.floor(Math.random() * valid.length)];
        }
      } catch {
        continue;
      }
    }
  } catch {
  }

  try {
    const params = new URLSearchParams({
      limit: '40',
      hidebroken: 'true',
      is_https: 'true',
      order: 'random'
    });
    const raw = await fetchFromMirrors<RawStation[]>(`/json/stations/search?${params.toString()}`);
    const valid = sanitizeStations(raw).filter((s) => s.stationuuid !== excludeUuid);
    if (valid.length > 0) {
      return valid[Math.floor(Math.random() * valid.length)];
    }
  } catch {
  }

  const fallback = await getFeaturedStations(30);
  const filtered = fallback.filter((s) => s.stationuuid !== excludeUuid);
  if (filtered.length === 0) {
    return null;
  }

  return filtered[Math.floor(Math.random() * filtered.length)];
}

export function reportStationClick(stationuuid: string): void {
  const baseUrl = API_MIRRORS[activeMirrorIndex];
  fetch(`${baseUrl}/json/url/${encodeURIComponent(stationuuid)}`).catch(() => {});
}