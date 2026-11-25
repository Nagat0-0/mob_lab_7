import '@ionic/core/css/core.css';
import '@ionic/core/css/normalize.css';
import '@ionic/core/css/structure.css';
import '@ionic/core/css/typography.css';
import './styles.css';

import { defineCustomElements } from '@ionic/core/loader';
import { addIcons } from 'ionicons';
import {
  bookmark,
  bookmarkOutline,
  checkmark,
  close,
  compass,
  compassOutline,
  globeOutline,
  heart,
  heartOutline,
  musicalNotesOutline,
  optionsOutline,
  pause,
  pencilOutline,
  planetOutline,
  play,
  radio,
  radioOutline,
  searchOutline,
  timerOutline,
  trashOutline
} from 'ionicons/icons';

import { radioPlayer } from './services/player';
import {
  getAllCountries,
  getAllTags,
  getFeaturedStations,
  searchStations,
  teleportStation
} from './services/radioApi';
import {
  clearHistory,
  getFavorites,
  getHistory,
  getLastStation,
  getPresets,
  isFavorite,
  setPreset,
  toggleFavorite
} from './services/storage';
import type { AppTab, CountryOption, ExploreFilter, PlayerState, RadioStation, TagOption } from './types';

(window as unknown as { Ionic?: { config?: Record<string, unknown> } }).Ionic = {
  config: { mode: 'ios' }
};

defineCustomElements(window);

addIcons({
  bookmark,
  'bookmark-outline': bookmarkOutline,
  checkmark,
  close,
  compass,
  'compass-outline': compassOutline,
  'globe-outline': globeOutline,
  heart,
  'heart-outline': heartOutline,
  'musical-notes-outline': musicalNotesOutline,
  'options-outline': optionsOutline,
  pause,
  'pencil-outline': pencilOutline,
  'planet-outline': planetOutline,
  play,
  radio,
  'radio-outline': radioOutline,
  'search-outline': searchOutline,
  'timer-outline': timerOutline,
  'trash-outline': trashOutline
});

const QUICK_GENRES = [
  { label: 'Lo-Fi', value: 'lofi' },
  { label: 'Synthwave', value: 'synthwave' },
  { label: 'Jazz', value: 'jazz' },
  { label: 'Rock', value: 'rock' },
  { label: 'Electronic', value: 'electronic' },
  { label: 'Pop', value: 'pop' },
  { label: 'Classical', value: 'classical' },
  { label: 'Chill', value: 'chill' },
  { label: 'News', value: 'news' }
];

const QUICK_COUNTRIES = [
  { label: 'Ukraine', code: 'UA' },
  { label: 'USA', code: 'US' },
  { label: 'Japan', code: 'JP' },
  { label: 'UK', code: 'GB' },
  { label: 'Germany', code: 'DE' },
  { label: 'France', code: 'FR' },
  { label: 'Brazil', code: 'BR' },
  { label: 'Korea', code: 'KR' },
  { label: 'Iceland', code: 'IS' }
];

let activeTab: AppTab = 'tuner';
let savedSegment: 'favorites' | 'history' = 'favorites';
let assignPresetMode = false;
let isTeleporting = false;
let exploreLoaded = false;
let exploreLoading = false;
let exploreError = '';
let exploreStations: RadioStation[] = [];
let exploreFilter: ExploreFilter = { query: '', tags: [], countryCodes: [] };
let searchDebounceId: number | null = null;
let toastTimeoutId: number | null = null;
let playerState: PlayerState = radioPlayer.getState();

let filterModalTab: 'countries' | 'genres' = 'countries';
let filterSearchQuery = '';
let allCountries: CountryOption[] = [];
let allTags: TagOption[] = [];
let filterCatalogLoading = false;
let filterCatalogError = '';
let draftCountries = new Set<string>();
let draftTags = new Set<string>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countryCodeToFlag(code: string): string {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) {
    return '🌐';
  }
  const offset = 127397;
  return String.fromCodePoint(clean.charCodeAt(0) + offset, clean.charCodeAt(1) + offset);
}

function getCountryDisplayName(code: string): string {
  const upper = code.toUpperCase();
  const quick = QUICK_COUNTRIES.find((c) => c.code === upper);
  if (quick) {
    return quick.label;
  }
  const fromCatalog = allCountries.find((c) => c.code === upper);
  if (fromCatalog) {
    return fromCatalog.name;
  }
  return upper;
}

function formatTimer(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatTags(tags: string): string {
  const parts = tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 3);
  return parts.length > 0 ? parts.join(' • ') : 'Live Stream';
}

function renderArtworkHtml(station: RadioStation | null): string {
  if (!station) {
    return '📻';
  }
  const flag = countryCodeToFlag(station.countrycode);
  if (station.favicon && station.favicon.startsWith('https://')) {
    return `<img src="${escapeHtml(station.favicon)}" alt="" loading="lazy" /><span>${flag}</span>`;
  }
  return `<span>${flag}</span>`;
}

function showToast(message: string): void {
  const el = document.getElementById('toast');
  if (!el) {
    return;
  }
  el.textContent = message;
  el.classList.add('visible');
  if (toastTimeoutId !== null) {
    window.clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = window.setTimeout(() => {
    el.classList.remove('visible');
  }, 2200);
}

function buildShell(): void {
  const app = document.getElementById('app');
  if (!app) {
    return;
  }

  const eqBars = Array.from({ length: 16 }, () => '<div class="eq-bar"></div>').join('');

  app.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-wrap">
          <div id="brand-dot" class="brand-dot"></div>
          <div class="brand-title">WorldTuner</div>
        </div>
        <div class="header-pills">
          <button id="header-sleep-pill" class="sleep-pill hidden" type="button">
            <ion-icon name="timer-outline"></ion-icon>
            <span id="header-sleep-text">00:00</span>
          </button>
          <div id="status-pill" class="status-pill">READY</div>
        </div>
      </header>

      <main class="views-container">
        <section id="view-tuner" class="tab-view">
          <div class="tuner-card">
            <div class="station-hero">
              <div id="tuner-art" class="station-art">📻</div>
              <div class="station-meta">
                <div id="tuner-country" class="station-country">🌐 Global Live Radio</div>
                <div id="tuner-name" class="station-name">Tap Teleport to tune in</div>
                <div id="tuner-specs" class="station-specs">
                  <span class="spec-badge">HTTPS Audio</span>
                </div>
              </div>
            </div>

            <div id="eq-wrapper" class="eq-wrapper">
              ${eqBars}
            </div>

            <div id="tuner-error" class="error-banner hidden"></div>

            <div class="controls-row">
              <button id="btn-favorite" class="ctrl-btn" type="button" aria-label="Favorite">
                <ion-icon name="heart-outline"></ion-icon>
              </button>

              <button id="btn-play" class="play-btn" type="button" aria-label="Play or Pause">
                <ion-icon name="play"></ion-icon>
              </button>

              <button id="btn-sleep" class="ctrl-btn" type="button" aria-label="Sleep Timer">
                <ion-icon name="timer-outline"></ion-icon>
              </button>
            </div>

            <button id="btn-teleport" class="teleport-btn" type="button">
              <ion-icon name="planet-outline"></ion-icon>
              <span>Teleport to Random Station</span>
            </button>
          </div>

          <div class="section-header">
            <div class="section-title">Retro Presets (1–6)</div>
            <button id="btn-toggle-assign" class="section-action" type="button">
              <ion-icon name="pencil-outline"></ion-icon>
              <span>Assign</span>
            </button>
          </div>

          <div id="presets-grid" class="presets-grid"></div>
        </section>

        <section id="view-explore" class="tab-view hidden">
          <div class="explore-search-row">
            <ion-searchbar id="explore-search" class="wt-searchbar" placeholder="Search radio stations..."></ion-searchbar>
            <button id="btn-open-filters" class="filter-open-btn" type="button" aria-label="Advanced filters">
              <ion-icon name="options-outline"></ion-icon>
              <span id="filter-count-badge" class="filter-count-badge hidden">0</span>
            </button>
          </div>
          <div id="genre-chips" class="chips-row"></div>
          <div id="country-chips" class="chips-row"></div>
          <div id="explore-list" class="station-list"></div>
        </section>

        <section id="view-saved" class="tab-view hidden">
          <div class="saved-toolbar">
            <ion-segment id="saved-segment" class="wt-segment" value="favorites">
              <ion-segment-button value="favorites">
                <ion-label>Favorites</ion-label>
              </ion-segment-button>
              <ion-segment-button value="history">
                <ion-label>History</ion-label>
              </ion-segment-button>
            </ion-segment>
            <button id="btn-clear-history" class="section-action hidden" type="button">
              <ion-icon name="trash-outline"></ion-icon>
              <span>Clear</span>
            </button>
          </div>
          <div id="saved-list" class="station-list"></div>
        </section>
      </main>

      <div id="mini-player" class="mini-player hidden">
        <div id="mini-thumb" class="mini-thumb">📻</div>
        <div class="mini-info">
          <div id="mini-name" class="mini-name">No station</div>
          <div id="mini-sub" class="mini-sub">Tap to open tuner</div>
        </div>
        <button id="mini-play-btn" class="mini-play-btn" type="button" aria-label="Play or Pause">
          <ion-icon name="play"></ion-icon>
        </button>
      </div>

      <div class="tab-bar-wrap">
        <nav class="wt-tab-bar" aria-label="Main navigation">
          <button id="tab-btn-tuner" class="wt-tab-btn active" type="button">
            <span class="tab-icon-slot"><ion-icon name="radio"></ion-icon></span>
            <span>Tuner</span>
          </button>
          <button id="tab-btn-explore" class="wt-tab-btn" type="button">
            <span class="tab-icon-slot"><ion-icon name="compass-outline"></ion-icon></span>
            <span>Explore</span>
          </button>
          <button id="tab-btn-saved" class="wt-tab-btn" type="button">
            <span class="tab-icon-slot"><ion-icon name="bookmark-outline"></ion-icon></span>
            <span>Saved</span>
          </button>
        </nav>
      </div>

      <div id="sleep-sheet" class="sheet-backdrop hidden">
        <div class="sheet-card">
          <div class="sheet-header">
            <div class="sheet-title">Sleep Timer</div>
            <button id="btn-close-sleep" class="sheet-close" type="button">
              <ion-icon name="close"></ion-icon>
            </button>
          </div>
          <div class="sleep-grid">
            <button class="sleep-option" data-minutes="5" type="button">5 min</button>
            <button class="sleep-option" data-minutes="15" type="button">15 min</button>
            <button class="sleep-option" data-minutes="30" type="button">30 min</button>
            <button class="sleep-option" data-minutes="45" type="button">45 min</button>
            <button class="sleep-option" data-minutes="60" type="button">60 min</button>
            <button class="sleep-option off" data-minutes="0" type="button">Off</button>
          </div>
        </div>
      </div>

      <div id="filter-sheet" class="sheet-backdrop hidden">
        <div class="sheet-card filter-sheet-card">
          <div class="sheet-header">
            <div class="sheet-title">Advanced Filters</div>
            <button id="btn-close-filter" class="sheet-close" type="button">
              <ion-icon name="close"></ion-icon>
            </button>
          </div>

          <div class="filter-tabs">
            <button id="filter-tab-countries" class="filter-tab-btn active" type="button">Countries</button>
            <button id="filter-tab-genres" class="filter-tab-btn" type="button">Genres</button>
          </div>

          <div class="filter-input-wrap">
            <ion-icon name="search-outline"></ion-icon>
            <input id="filter-search-input" class="filter-input" type="text" placeholder="Search all countries..." />
          </div>

          <div id="filter-options-list" class="filter-options-list"></div>

          <div class="filter-footer">
            <button id="btn-reset-filters" class="filter-reset-btn" type="button">Reset All</button>
            <button id="btn-apply-filters" class="filter-apply-btn" type="button">Apply Filters</button>
          </div>
        </div>
      </div>

      <div id="toast" class="toast-pill"></div>
    </div>
  `;
}

function updatePlayerUi(): void {
  const { station, status, errorMessage, sleepRemainingSec } = playerState;

  const brandDot = document.getElementById('brand-dot');
  const statusPill = document.getElementById('status-pill');
  const headerSleepPill = document.getElementById('header-sleep-pill');
  const headerSleepText = document.getElementById('header-sleep-text');
  const tunerArt = document.getElementById('tuner-art');
  const tunerCountry = document.getElementById('tuner-country');
  const tunerName = document.getElementById('tuner-name');
  const tunerSpecs = document.getElementById('tuner-specs');
  const eqWrapper = document.getElementById('eq-wrapper');
  const tunerError = document.getElementById('tuner-error');
  const btnPlay = document.getElementById('btn-play');
  const btnFav = document.getElementById('btn-favorite');
  const btnSleep = document.getElementById('btn-sleep');

  if (brandDot) {
    brandDot.className = 'brand-dot';
    if (status === 'playing') {
      brandDot.classList.add('live');
    } else if (status === 'loading') {
      brandDot.classList.add('loading');
    }
  }

  if (statusPill) {
    statusPill.className = 'status-pill';
    if (status === 'playing') {
      statusPill.textContent = 'ON AIR';
      statusPill.classList.add('live');
    } else if (status === 'loading') {
      statusPill.textContent = 'TUNING';
      statusPill.classList.add('loading');
    } else if (status === 'error') {
      statusPill.textContent = 'OFFLINE';
      statusPill.classList.add('error');
    } else if (status === 'paused') {
      statusPill.textContent = 'PAUSED';
    } else {
      statusPill.textContent = 'READY';
    }
  }

  if (headerSleepPill && headerSleepText) {
    if (sleepRemainingSec > 0) {
      headerSleepPill.classList.remove('hidden');
      headerSleepText.textContent = formatTimer(sleepRemainingSec);
    } else {
      headerSleepPill.classList.add('hidden');
    }
  }

  if (btnSleep) {
    btnSleep.classList.toggle('timer-active', sleepRemainingSec > 0);
  }

  if (tunerArt && tunerCountry && tunerName && tunerSpecs) {
    if (station) {
      const flag = countryCodeToFlag(station.countrycode);
      tunerArt.innerHTML = renderArtworkHtml(station);
      const artImg = tunerArt.querySelector('img');
      const artSpan = tunerArt.querySelector('span');
      if (artImg && artSpan) {
        artSpan.style.display = 'none';
        artImg.addEventListener('error', () => {
          artImg.remove();
          artSpan.style.display = 'inline';
        });
      }
      tunerCountry.textContent = `${flag} ${station.country}`;
      tunerName.textContent = station.name;
      const bitrateLabel = station.bitrate > 0 ? `${station.codec} • ${station.bitrate} kbps` : station.codec;
      tunerSpecs.innerHTML = `
        <span class="spec-badge">${escapeHtml(bitrateLabel)}</span>
        <span class="spec-badge">${escapeHtml(formatTags(station.tags))}</span>
      `;
    } else {
      tunerArt.innerHTML = '📻';
      tunerCountry.textContent = '🌐 Global Live Radio';
      tunerName.textContent = 'Tap Teleport to tune in';
      tunerSpecs.innerHTML = '<span class="spec-badge">HTTPS Audio</span>';
    }
  }

  if (eqWrapper) {
    eqWrapper.classList.toggle('playing', status === 'playing');
  }

  if (tunerError) {
    if (status === 'error' && errorMessage) {
      tunerError.textContent = errorMessage;
      tunerError.classList.remove('hidden');
    } else {
      tunerError.classList.add('hidden');
    }
  }

  if (btnPlay) {
    if (status === 'loading') {
      btnPlay.innerHTML = '<ion-spinner name="crescent"></ion-spinner>';
    } else if (status === 'playing') {
      btnPlay.innerHTML = '<ion-icon name="pause"></ion-icon>';
    } else {
      btnPlay.innerHTML = '<ion-icon name="play"></ion-icon>';
    }
  }

  if (btnFav) {
    const fav = station ? isFavorite(station.stationuuid) : false;
    btnFav.classList.toggle('active', fav);
    btnFav.innerHTML = `<ion-icon name="${fav ? 'heart' : 'heart-outline'}"></ion-icon>`;
  }

  updateMiniPlayer();
  renderPresets();
  if (activeTab === 'explore' && exploreLoaded) {
    highlightActiveStationInList('explore-list');
  }
  if (activeTab === 'saved') {
    renderSavedList();
  }
}

function updateMiniPlayer(): void {
  const mini = document.getElementById('mini-player');
  const thumb = document.getElementById('mini-thumb');
  const name = document.getElementById('mini-name');
  const sub = document.getElementById('mini-sub');
  const playBtn = document.getElementById('mini-play-btn');

  if (!mini || !thumb || !name || !sub || !playBtn) {
    return;
  }

  const { station, status } = playerState;
  if (!station || activeTab === 'tuner') {
    mini.classList.add('hidden');
    return;
  }

  mini.classList.remove('hidden');
  thumb.textContent = countryCodeToFlag(station.countrycode);
  name.textContent = station.name;
  sub.textContent =
    status === 'playing'
      ? `On Air • ${station.country}`
      : status === 'loading'
        ? 'Connecting...'
        : station.country;

  if (status === 'loading') {
    playBtn.innerHTML =
      '<ion-spinner name="crescent" style="width:18px;height:18px;--color:#090c14;"></ion-spinner>';
  } else if (status === 'playing') {
    playBtn.innerHTML = '<ion-icon name="pause"></ion-icon>';
  } else {
    playBtn.innerHTML = '<ion-icon name="play"></ion-icon>';
  }
}

function renderPresets(): void {
  const grid = document.getElementById('presets-grid');
  const toggleBtn = document.getElementById('btn-toggle-assign');
  if (!grid) {
    return;
  }

  if (toggleBtn) {
    toggleBtn.classList.toggle('active', assignPresetMode);
    toggleBtn.innerHTML = assignPresetMode
      ? '<ion-icon name="checkmark"></ion-icon><span>Done</span>'
      : '<ion-icon name="pencil-outline"></ion-icon><span>Assign</span>';
  }

  const presets = getPresets();
  const activeUuid = playerState.station?.stationuuid ?? '';

  grid.innerHTML = presets
    .map((slot, index) => {
      const slotNum = String(index + 1).padStart(2, '0');
      const isCurrent = Boolean(slot && slot.stationuuid === activeUuid);
      const classes = ['preset-slot'];
      if (isCurrent) {
        classes.push('active-station');
      }
      if (assignPresetMode) {
        classes.push('assign-mode');
      }

      if (slot) {
        const flag = countryCodeToFlag(slot.countrycode);
        const clearBtn = assignPresetMode
          ? `<span class="preset-clear" data-clear-preset="${index}" role="button" aria-label="Clear preset"><ion-icon name="close"></ion-icon></span>`
          : '';
        return `
          <button class="${classes.join(' ')}" data-preset-index="${index}" type="button">
            <div class="preset-top">
              <span class="preset-num">CH ${slotNum}</span>
              ${clearBtn}
            </div>
            <div class="preset-name">${flag} ${escapeHtml(slot.name)}</div>
            <div class="preset-sub">${escapeHtml(slot.country)}</div>
          </button>
        `;
      }

      return `
        <button class="${classes.join(' ')}" data-preset-index="${index}" type="button">
          <div class="preset-top">
            <span class="preset-num">CH ${slotNum}</span>
          </div>
          <div class="preset-empty">${assignPresetMode ? 'Tap to save current' : 'Empty slot'}</div>
        </button>
      `;
    })
    .join('');
}

function renderFilterChips(): void {
  const genreRow = document.getElementById('genre-chips');
  const countryRow = document.getElementById('country-chips');
  const filterBtn = document.getElementById('btn-open-filters');
  const badge = document.getElementById('filter-count-badge');

  const totalFilters = exploreFilter.tags.length + exploreFilter.countryCodes.length;
  if (filterBtn && badge) {
    filterBtn.classList.toggle('has-filters', totalFilters > 0);
    badge.classList.toggle('hidden', totalFilters === 0);
    badge.textContent = String(totalFilters);
  }

  if (genreRow) {
    const quickValues = new Set(QUICK_GENRES.map((g) => g.value));
    const extraTags = exploreFilter.tags.filter((t) => !quickValues.has(t));

    const allBtn = `<button class="filter-chip ${exploreFilter.tags.length === 0 ? 'selected' : ''}" data-tag="" type="button">All</button>`;
    const extraBtns = extraTags
      .map(
        (tag) =>
          `<button class="filter-chip selected" data-tag="${escapeHtml(tag)}" type="button">#${escapeHtml(tag)}</button>`
      )
      .join('');
    const quickBtns = QUICK_GENRES.map((item) => {
      const selected = exploreFilter.tags.includes(item.value);
      return `<button class="filter-chip ${selected ? 'selected' : ''}" data-tag="${escapeHtml(item.value)}" type="button">${escapeHtml(item.label)}</button>`;
    }).join('');

    genreRow.innerHTML = `${allBtn}${extraBtns}${quickBtns}`;
  }

  if (countryRow) {
    const quickCodes = new Set(QUICK_COUNTRIES.map((c) => c.code));
    const extraCodes = exploreFilter.countryCodes.filter((c) => !quickCodes.has(c));

    const allBtn = `<button class="filter-chip ${exploreFilter.countryCodes.length === 0 ? 'selected' : ''}" data-country="" type="button">All World</button>`;
    const extraBtns = extraCodes
      .map((code) => {
        const flag = countryCodeToFlag(code);
        const label = getCountryDisplayName(code);
        return `<button class="filter-chip selected" data-country="${escapeHtml(code)}" type="button">${flag} ${escapeHtml(label)}</button>`;
      })
      .join('');
    const quickBtns = QUICK_COUNTRIES.map((item) => {
      const selected = exploreFilter.countryCodes.includes(item.code);
      const flag = countryCodeToFlag(item.code);
      return `<button class="filter-chip ${selected ? 'selected' : ''}" data-country="${escapeHtml(item.code)}" type="button">${flag} ${escapeHtml(item.label)}</button>`;
    }).join('');

    countryRow.innerHTML = `${allBtn}${extraBtns}${quickBtns}`;
  }
}

function buildStationCardsHtml(stations: RadioStation[], listType: 'explore' | 'saved'): string {
  const activeUuid = playerState.station?.stationuuid ?? '';

  return stations
    .map((station, index) => {
      const flag = countryCodeToFlag(station.countrycode);
      const fav = isFavorite(station.stationuuid);
      const isCurrent = station.stationuuid === activeUuid;
      const spec = station.bitrate > 0 ? `${station.codec} ${station.bitrate}k` : station.codec;
      const sub = `${station.country} • ${spec}`;

      return `
        <div class="station-item ${isCurrent ? 'current' : ''}" data-list-type="${listType}" data-station-index="${index}" data-station-uuid="${escapeHtml(station.stationuuid)}">
          <div class="item-thumb">${flag}</div>
          <div class="item-info">
            <div class="item-name">${escapeHtml(station.name)}</div>
            <div class="item-sub">${escapeHtml(sub)}</div>
          </div>
          <button class="item-fav-btn ${fav ? 'active' : ''}" data-fav-index="${index}" data-list-type="${listType}" type="button" aria-label="Toggle favorite">
            <ion-icon name="${fav ? 'heart' : 'heart-outline'}"></ion-icon>
          </button>
        </div>
      `;
    })
    .join('');
}

function highlightActiveStationInList(containerId: string): void {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }
  const activeUuid = playerState.station?.stationuuid ?? '';
  const items = container.querySelectorAll<HTMLElement>('.station-item');
  items.forEach((el) => {
    const uuid = el.dataset.stationUuid ?? '';
    el.classList.toggle('current', Boolean(activeUuid && uuid === activeUuid));
    const favBtn = el.querySelector<HTMLElement>('.item-fav-btn');
    if (favBtn && uuid) {
      const fav = isFavorite(uuid);
      favBtn.classList.toggle('active', fav);
      favBtn.innerHTML = `<ion-icon name="${fav ? 'heart' : 'heart-outline'}"></ion-icon>`;
    }
  });
}

function renderExploreList(): void {
  const container = document.getElementById('explore-list');
  if (!container) {
    return;
  }

  if (exploreLoading) {
    container.innerHTML = `
      <div class="state-box">
        <ion-spinner name="crescent" color="primary"></ion-spinner>
        <div class="state-box-sub">Scanning global frequencies...</div>
      </div>
    `;
    return;
  }

  if (exploreError) {
    container.innerHTML = `
      <div class="state-box">
        <ion-icon name="globe-outline"></ion-icon>
        <div class="state-box-title">Directory unavailable</div>
        <div class="state-box-sub">${escapeHtml(exploreError)}</div>
        <button id="btn-retry-explore" class="section-action" type="button">Try Again</button>
      </div>
    `;
    return;
  }

  if (exploreStations.length === 0) {
    container.innerHTML = `
      <div class="state-box">
        <ion-icon name="musical-notes-outline"></ion-icon>
        <div class="state-box-title">No stations found</div>
        <div class="state-box-sub">Try different countries, genres, or reset filters.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = buildStationCardsHtml(exploreStations, 'explore');
}

function renderSavedList(): void {
  const container = document.getElementById('saved-list');
  const clearBtn = document.getElementById('btn-clear-history');
  if (!container) {
    return;
  }

  const stations = savedSegment === 'favorites' ? getFavorites() : getHistory();

  if (clearBtn) {
    clearBtn.classList.toggle('hidden', savedSegment !== 'history' || stations.length === 0);
  }

  if (stations.length === 0) {
    const title = savedSegment === 'favorites' ? 'No favorite stations yet' : 'Listening history is empty';
    const sub =
      savedSegment === 'favorites'
        ? 'Tap the heart icon on any live station to keep it in your collection.'
        : 'Stations you tune into will appear here automatically.';
    container.innerHTML = `
      <div class="state-box">
        <ion-icon name="${savedSegment === 'favorites' ? 'heart-outline' : 'radio-outline'}"></ion-icon>
        <div class="state-box-title">${title}</div>
        <div class="state-box-sub">${sub}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = buildStationCardsHtml(stations, 'saved');
}

async function loadExploreStations(): Promise<void> {
  exploreLoading = true;
  exploreError = '';
  renderExploreList();

  try {
    const hasFilter = Boolean(
      exploreFilter.query.trim() || exploreFilter.tags.length > 0 || exploreFilter.countryCodes.length > 0
    );
    exploreStations = hasFilter ? await searchStations(exploreFilter, 45) : await getFeaturedStations(35);
    exploreLoaded = true;
  } catch (err) {
    exploreError = err instanceof Error ? err.message : 'Failed to load radio stations.';
  } finally {
    exploreLoading = false;
    renderExploreList();
  }
}

function renderFilterModal(): void {
  const countriesTab = document.getElementById('filter-tab-countries');
  const genresTab = document.getElementById('filter-tab-genres');
  const searchInput = document.getElementById('filter-search-input') as HTMLInputElement | null;
  const listEl = document.getElementById('filter-options-list');
  const applyBtn = document.getElementById('btn-apply-filters');

  if (countriesTab) {
    countriesTab.classList.toggle('active', filterModalTab === 'countries');
    countriesTab.textContent =
      draftCountries.size > 0 ? `Countries (${draftCountries.size})` : 'Countries';
  }

  if (genresTab) {
    genresTab.classList.toggle('active', filterModalTab === 'genres');
    genresTab.textContent = draftTags.size > 0 ? `Genres (${draftTags.size})` : 'Genres';
  }

  if (searchInput) {
    searchInput.placeholder =
      filterModalTab === 'countries' ? 'Search all countries...' : 'Search all genres...';
  }

  if (applyBtn) {
    const total = draftCountries.size + draftTags.size;
    applyBtn.textContent = total > 0 ? `Apply Filters (${total})` : 'Apply Filters';
  }

  if (!listEl) {
    return;
  }

  if (filterCatalogLoading) {
    listEl.innerHTML = `
      <div class="state-box">
        <ion-spinner name="crescent" color="primary"></ion-spinner>
        <div class="state-box-sub">Loading full API catalog...</div>
      </div>
    `;
    return;
  }

  if (filterCatalogError) {
    listEl.innerHTML = `
      <div class="state-box">
        <ion-icon name="globe-outline"></ion-icon>
        <div class="state-box-title">Failed to load catalog</div>
        <div class="state-box-sub">${escapeHtml(filterCatalogError)}</div>
        <button id="btn-retry-catalog" class="section-action" type="button">Retry</button>
      </div>
    `;
    return;
  }

  const q = filterSearchQuery.trim().toLowerCase();

  if (filterModalTab === 'countries') {
    const filtered = allCountries
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
      .sort((a, b) => {
        const aSel = draftCountries.has(a.code) ? 1 : 0;
        const bSel = draftCountries.has(b.code) ? 1 : 0;
        if (aSel !== bSel) {
          return bSel - aSel;
        }
        return b.stationcount - a.stationcount;
      });

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="state-box"><div class="state-box-sub">No matching countries</div></div>';
      return;
    }

    listEl.innerHTML = filtered
      .map((item) => {
        const selected = draftCountries.has(item.code);
        const flag = countryCodeToFlag(item.code);
        return `
          <button class="filter-option-row ${selected ? 'selected' : ''}" data-filter-country="${escapeHtml(item.code)}" type="button">
            <span class="filter-option-left">
              <span>${flag}</span>
              <span class="filter-option-name">${escapeHtml(item.name)}</span>
            </span>
            <span class="filter-option-right">
              <span class="filter-option-count">${item.stationcount}</span>
              <span class="filter-check">${selected ? '<ion-icon name="checkmark"></ion-icon>' : ''}</span>
            </span>
          </button>
        `;
      })
      .join('');
    return;
  }

  const filteredTags = allTags
    .filter((t) => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const aSel = draftTags.has(a.name) ? 1 : 0;
      const bSel = draftTags.has(b.name) ? 1 : 0;
      if (aSel !== bSel) {
        return bSel - aSel;
      }
      return b.stationcount - a.stationcount;
    });

  if (filteredTags.length === 0) {
    listEl.innerHTML = '<div class="state-box"><div class="state-box-sub">No matching genres</div></div>';
    return;
  }

  listEl.innerHTML = filteredTags
    .map((item) => {
      const selected = draftTags.has(item.name);
      return `
        <button class="filter-option-row ${selected ? 'selected' : ''}" data-filter-tag="${escapeHtml(item.name)}" type="button">
          <span class="filter-option-left">
            <span class="filter-option-name">#${escapeHtml(item.name)}</span>
          </span>
          <span class="filter-option-right">
            <span class="filter-option-count">${item.stationcount}</span>
            <span class="filter-check">${selected ? '<ion-icon name="checkmark"></ion-icon>' : ''}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

async function ensureFilterCatalogLoaded(): Promise<void> {
  if (allCountries.length > 0 && allTags.length > 0) {
    return;
  }

  filterCatalogLoading = true;
  filterCatalogError = '';
  renderFilterModal();

  try {
    const [countries, tags] = await Promise.all([getAllCountries(), getAllTags()]);
    allCountries = countries;
    allTags = tags;
  } catch (err) {
    filterCatalogError = err instanceof Error ? err.message : 'Unable to load options';
  } finally {
    filterCatalogLoading = false;
    renderFilterModal();
  }
}

function openFilterSheet(): void {
  draftCountries = new Set(exploreFilter.countryCodes);
  draftTags = new Set(exploreFilter.tags);
  filterSearchQuery = '';

  const searchInput = document.getElementById('filter-search-input') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
  }

  document.getElementById('filter-sheet')?.classList.remove('hidden');
  renderFilterModal();
  void ensureFilterCatalogLoaded();
}

function closeFilterSheet(): void {
  document.getElementById('filter-sheet')?.classList.add('hidden');
}

async function handleTeleport(): Promise<void> {
  if (isTeleporting) {
    return;
  }

  const btn = document.getElementById('btn-teleport') as HTMLButtonElement | null;
  isTeleporting = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<ion-spinner name="crescent" style="width:18px;height:18px;--color:#38bdf8;"></ion-spinner><span>Teleporting...</span>';
  }

  try {
    const station = await teleportStation(playerState.station?.stationuuid);
    if (!station) {
      showToast('Could not reach a random station');
      return;
    }
    const flag = countryCodeToFlag(station.countrycode);
    showToast(`Teleported to ${flag} ${station.country}`);
    await radioPlayer.playStation(station);
  } catch {
    showToast('Network error during teleport');
  } finally {
    isTeleporting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<ion-icon name="planet-outline"></ion-icon><span>Teleport to Random Station</span>';
    }
  }
}

function cyclePreset(direction: 1 | -1): void {
  const filled = getPresets().filter((s): s is RadioStation => s !== null);
  if (filled.length < 2) {
    void handleTeleport();
    return;
  }
  const currentUuid = playerState.station?.stationuuid ?? '';
  const currentIdx = filled.findIndex((s) => s.stationuuid === currentUuid);
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + direction + filled.length) % filled.length;
  void radioPlayer.playStation(filled[nextIdx]);
}

function switchTab(tab: AppTab): void {
  activeTab = tab;

  const views: Record<AppTab, string> = {
    tuner: 'view-tuner',
    explore: 'view-explore',
    saved: 'view-saved'
  };

  (Object.keys(views) as AppTab[]).forEach((key) => {
    const el = document.getElementById(views[key]);
    el?.classList.toggle('hidden', key !== tab);
  });

  const tabsConfig: { id: string; key: AppTab; activeIcon: string; inactiveIcon: string }[] = [
    { id: 'tab-btn-tuner', key: 'tuner', activeIcon: 'radio', inactiveIcon: 'radio-outline' },
    { id: 'tab-btn-explore', key: 'explore', activeIcon: 'compass', inactiveIcon: 'compass-outline' },
    { id: 'tab-btn-saved', key: 'saved', activeIcon: 'bookmark', inactiveIcon: 'bookmark-outline' }
  ];

  tabsConfig.forEach((cfg) => {
    const btn = document.getElementById(cfg.id);
    if (!btn) {
      return;
    }
    const isActive = cfg.key === tab;
    btn.classList.toggle('active', isActive);
    const slot = btn.querySelector('.tab-icon-slot');
    if (slot) {
      slot.innerHTML = `<ion-icon name="${isActive ? cfg.activeIcon : cfg.inactiveIcon}"></ion-icon>`;
    }
  });

  updateMiniPlayer();

  if (tab === 'explore' && !exploreLoaded && !exploreLoading) {
    void loadExploreStations();
  }

  if (tab === 'saved') {
    renderSavedList();
  }
}

function setSleepSheetVisible(visible: boolean): void {
  const sheet = document.getElementById('sleep-sheet');
  sheet?.classList.toggle('hidden', !visible);
}

function bindEvents(): void {
  document.getElementById('tab-btn-tuner')?.addEventListener('click', () => switchTab('tuner'));
  document.getElementById('tab-btn-explore')?.addEventListener('click', () => switchTab('explore'));
  document.getElementById('tab-btn-saved')?.addEventListener('click', () => switchTab('saved'));

  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (!playerState.station) {
      void handleTeleport();
      return;
    }
    void radioPlayer.togglePlayPause();
  });

  document.getElementById('btn-favorite')?.addEventListener('click', () => {
    if (!playerState.station) {
      showToast('Tune into a station first');
      return;
    }
    const added = toggleFavorite(playerState.station);
    showToast(added ? 'Added to Favorites' : 'Removed from Favorites');
    updatePlayerUi();
  });

  document.getElementById('btn-sleep')?.addEventListener('click', () => setSleepSheetVisible(true));
  document.getElementById('header-sleep-pill')?.addEventListener('click', () => setSleepSheetVisible(true));
  document.getElementById('btn-close-sleep')?.addEventListener('click', () => setSleepSheetVisible(false));

  document.getElementById('sleep-sheet')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'sleep-sheet') {
      setSleepSheetVisible(false);
      return;
    }
    const option = target.closest<HTMLElement>('[data-minutes]');
    if (!option) {
      return;
    }
    const minutes = Number(option.dataset.minutes ?? '0');
    radioPlayer.setSleepTimer(minutes);
    setSleepSheetVisible(false);
    showToast(minutes > 0 ? `Sleep timer set for ${minutes} min` : 'Sleep timer turned off');
  });

  document.getElementById('btn-open-filters')?.addEventListener('click', () => openFilterSheet());
  document.getElementById('btn-close-filter')?.addEventListener('click', () => closeFilterSheet());

  document.getElementById('filter-sheet')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.id === 'filter-sheet') {
      closeFilterSheet();
      return;
    }

    if (target.closest('#btn-retry-catalog')) {
      void ensureFilterCatalogLoaded();
      return;
    }

    const countryRow = target.closest<HTMLElement>('[data-filter-country]');
    if (countryRow) {
      const code = countryRow.dataset.filterCountry ?? '';
      if (code) {
        if (draftCountries.has(code)) {
          draftCountries.delete(code);
        } else {
          draftCountries.add(code);
        }
        renderFilterModal();
      }
      return;
    }

    const tagRow = target.closest<HTMLElement>('[data-filter-tag]');
    if (tagRow) {
      const tag = tagRow.dataset.filterTag ?? '';
      if (tag) {
        if (draftTags.has(tag)) {
          draftTags.delete(tag);
        } else {
          draftTags.add(tag);
        }
        renderFilterModal();
      }
    }
  });

  document.getElementById('filter-tab-countries')?.addEventListener('click', () => {
    filterModalTab = 'countries';
    filterSearchQuery = '';
    const input = document.getElementById('filter-search-input') as HTMLInputElement | null;
    if (input) {
      input.value = '';
    }
    renderFilterModal();
  });

  document.getElementById('filter-tab-genres')?.addEventListener('click', () => {
    filterModalTab = 'genres';
    filterSearchQuery = '';
    const input = document.getElementById('filter-search-input') as HTMLInputElement | null;
    if (input) {
      input.value = '';
    }
    renderFilterModal();
  });

  document.getElementById('filter-search-input')?.addEventListener('input', (event) => {
    filterSearchQuery = (event.target as HTMLInputElement).value ?? '';
    renderFilterModal();
  });

  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    draftCountries.clear();
    draftTags.clear();
    renderFilterModal();
  });

  document.getElementById('btn-apply-filters')?.addEventListener('click', () => {
    exploreFilter.countryCodes = Array.from(draftCountries);
    exploreFilter.tags = Array.from(draftTags);
    closeFilterSheet();
    renderFilterChips();
    void loadExploreStations();
  });

  document.getElementById('btn-teleport')?.addEventListener('click', () => {
    void handleTeleport();
  });

  document.getElementById('btn-toggle-assign')?.addEventListener('click', () => {
    assignPresetMode = !assignPresetMode;
    renderPresets();
    if (assignPresetMode) {
      showToast('Tap any slot (1–6) to save current station');
    }
  });

  document.getElementById('presets-grid')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const clearTrigger = target.closest<HTMLElement>('[data-clear-preset]');
    if (clearTrigger) {
      event.stopPropagation();
      const idx = Number(clearTrigger.dataset.clearPreset ?? '-1');
      if (idx >= 0) {
        setPreset(idx, null);
        renderPresets();
        showToast(`Preset ${idx + 1} cleared`);
      }
      return;
    }

    const slotBtn = target.closest<HTMLElement>('[data-preset-index]');
    if (!slotBtn) {
      return;
    }

    const idx = Number(slotBtn.dataset.presetIndex ?? '-1');
    if (idx < 0) {
      return;
    }

    const slots = getPresets();
    const existing = slots[idx];

    if (assignPresetMode || !existing) {
      if (!playerState.station) {
        showToast('Play a station first to save it');
        return;
      }
      setPreset(idx, playerState.station);
      assignPresetMode = false;
      renderPresets();
      showToast(`Saved to Preset ${idx + 1}`);
      return;
    }

    void radioPlayer.playStation(existing);
  });

  const searchbar = document.getElementById('explore-search');
  searchbar?.addEventListener('ionInput', (event) => {
    const customEvent = event as CustomEvent<{ value?: string | null }>;
    exploreFilter.query = customEvent.detail?.value ?? '';
    if (searchDebounceId !== null) {
      window.clearTimeout(searchDebounceId);
    }
    searchDebounceId = window.setTimeout(() => {
      void loadExploreStations();
    }, 350);
  });

  document.getElementById('genre-chips')?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-tag]');
    if (!btn) {
      return;
    }
    const tag = btn.dataset.tag ?? '';
    if (!tag) {
      exploreFilter.tags = [];
    } else if (exploreFilter.tags.includes(tag)) {
      exploreFilter.tags = exploreFilter.tags.filter((t) => t !== tag);
    } else {
      exploreFilter.tags = [...exploreFilter.tags, tag];
    }
    renderFilterChips();
    void loadExploreStations();
  });

  document.getElementById('country-chips')?.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-country]');
    if (!btn) {
      return;
    }
    const code = btn.dataset.country ?? '';
    if (!code) {
      exploreFilter.countryCodes = [];
    } else if (exploreFilter.countryCodes.includes(code)) {
      exploreFilter.countryCodes = exploreFilter.countryCodes.filter((c) => c !== code);
    } else {
      exploreFilter.countryCodes = [...exploreFilter.countryCodes, code];
    }
    renderFilterChips();
    void loadExploreStations();
  });

  const handleListClick = (event: Event, listType: 'explore' | 'saved') => {
    const target = event.target as HTMLElement;

    if (target.closest('#btn-retry-explore')) {
      void loadExploreStations();
      return;
    }

    const stations =
      listType === 'explore'
        ? exploreStations
        : savedSegment === 'favorites'
          ? getFavorites()
          : getHistory();

    const favBtn = target.closest<HTMLElement>('[data-fav-index]');
    if (favBtn) {
      event.stopPropagation();
      const idx = Number(favBtn.dataset.favIndex ?? '-1');
      const station = stations[idx];
      if (!station) {
        return;
      }
      const added = toggleFavorite(station);
      showToast(added ? 'Added to Favorites' : 'Removed from Favorites');
      updatePlayerUi();
      if (listType === 'explore') {
        highlightActiveStationInList('explore-list');
      } else {
        renderSavedList();
      }
      return;
    }

    const row = target.closest<HTMLElement>('[data-station-index]');
    if (!row) {
      return;
    }
    const idx = Number(row.dataset.stationIndex ?? '-1');
    const station = stations[idx];
    if (!station) {
      return;
    }

    void radioPlayer.playStation(station);
  };

  document.getElementById('explore-list')?.addEventListener('click', (e) => handleListClick(e, 'explore'));
  document.getElementById('saved-list')?.addEventListener('click', (e) => handleListClick(e, 'saved'));

  document.getElementById('saved-segment')?.addEventListener('ionChange', (event) => {
    const customEvent = event as CustomEvent<{ value?: string }>;
    savedSegment = customEvent.detail?.value === 'history' ? 'history' : 'favorites';
    renderSavedList();
  });

  document.getElementById('btn-clear-history')?.addEventListener('click', () => {
    clearHistory();
    renderSavedList();
    showToast('History cleared');
  });

  document.getElementById('mini-player')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('#mini-play-btn')) {
      event.stopPropagation();
      void radioPlayer.togglePlayPause();
      return;
    }
    switchTab('tuner');
  });
}

function bootstrap(): void {
  buildShell();
  renderFilterChips();
  bindEvents();

  radioPlayer.setMediaNavigationHandlers(
    () => cyclePreset(-1),
    () => cyclePreset(1)
  );

  radioPlayer.subscribe((state) => {
    playerState = state;
    updatePlayerUi();
  });

  const last = getLastStation();
  if (last) {
    radioPlayer.setInitialStation(last);
  }
}

bootstrap();