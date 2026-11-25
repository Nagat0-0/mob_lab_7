import type { PlayerState, RadioStation } from '../types';
import { reportStationClick } from './radioApi';
import { addToHistory, setLastStation } from './storage';

type StateListener = (state: PlayerState) => void;

class RadioPlayer {
  private audio: HTMLAudioElement;
  private listeners = new Set<StateListener>();
  private state: PlayerState = {
    station: null,
    status: 'idle',
    errorMessage: '',
    sleepRemainingSec: 0
  };
  private sleepIntervalId: number | null = null;
  private playRequestId = 0;
  private onPrevHandler: (() => void) | null = null;
  private onNextHandler: (() => void) | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'none';

    this.audio.addEventListener('playing', () => {
      this.updateState({ status: 'playing', errorMessage: '' });
      this.syncMediaPlaybackState('playing');
    });

    this.audio.addEventListener('waiting', () => {
      if (this.state.station && !this.audio.paused) {
        this.updateState({ status: 'loading' });
      }
    });

    this.audio.addEventListener('pause', () => {
      if (this.state.status === 'playing' || this.state.status === 'loading') {
        this.updateState({ status: 'paused' });
      }
      this.syncMediaPlaybackState('paused');
    });

    this.audio.addEventListener('error', () => {
      if (!this.state.station) {
        return;
      }
      this.updateState({
        status: 'error',
        errorMessage: 'Stream unavailable on this device. Try another station.'
      });
      this.syncMediaPlaybackState('none');
    });

    this.setupMediaSessionActions();
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener({ ...this.state });
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): PlayerState {
    return { ...this.state };
  }

  public setInitialStation(station: RadioStation | null): void {
    if (!this.state.station && station) {
      this.updateState({ station, status: 'idle', errorMessage: '' });
      this.updateMediaMetadata(station);
    }
  }

  public setMediaNavigationHandlers(onPrev: () => void, onNext: () => void): void {
    this.onPrevHandler = onPrev;
    this.onNextHandler = onNext;
  }

  public async playStation(station: RadioStation): Promise<void> {
    const requestId = ++this.playRequestId;

    this.audio.pause();
    this.audio.volume = 1;
    this.updateState({
      station,
      status: 'loading',
      errorMessage: ''
    });

    setLastStation(station);
    addToHistory(station);
    reportStationClick(station.stationuuid);
    this.updateMediaMetadata(station);

    this.audio.src = station.url_resolved;
    this.audio.load();

    try {
      await this.audio.play();
      if (requestId !== this.playRequestId) {
        return;
      }
      this.updateState({ status: 'playing', errorMessage: '' });
      this.syncMediaPlaybackState('playing');
    } catch (err) {
      if (requestId !== this.playRequestId) {
        return;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      this.updateState({
        status: 'error',
        errorMessage: 'Could not start audio stream. Tap Play or pick another station.'
      });
      this.syncMediaPlaybackState('none');
    }
  }

  public async togglePlayPause(): Promise<void> {
    if (!this.state.station) {
      return;
    }

    if (this.state.status === 'playing' || this.state.status === 'loading') {
      this.playRequestId++;
      this.audio.pause();
      this.updateState({ status: 'paused', errorMessage: '' });
      this.syncMediaPlaybackState('paused');
      return;
    }

    await this.playStation(this.state.station);
  }

  public stop(): void {
    this.playRequestId++;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.updateState({ status: 'paused', errorMessage: '' });
    this.syncMediaPlaybackState('none');
  }

  public setSleepTimer(minutes: number): void {
    if (this.sleepIntervalId !== null) {
      window.clearInterval(this.sleepIntervalId);
      this.sleepIntervalId = null;
    }

    if (minutes <= 0) {
      this.audio.volume = 1;
      this.updateState({ sleepRemainingSec: 0 });
      return;
    }

    const totalSec = minutes * 60;
    this.updateState({ sleepRemainingSec: totalSec });

    this.sleepIntervalId = window.setInterval(() => {
      const next = this.state.sleepRemainingSec - 1;
      if (next <= 0) {
        if (this.sleepIntervalId !== null) {
          window.clearInterval(this.sleepIntervalId);
          this.sleepIntervalId = null;
        }
        this.audio.pause();
        this.audio.volume = 1;
        this.updateState({ sleepRemainingSec: 0, status: 'paused' });
        this.syncMediaPlaybackState('paused');
        return;
      }

      if (next <= 3) {
        try {
          this.audio.volume = Math.max(0.1, next / 3);
        } catch {
        }
      }

      this.updateState({ sleepRemainingSec: next });
    }, 1000);
  }

  private updateState(partial: Partial<PlayerState>): void {
    this.state = { ...this.state, ...partial };
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private setupMediaSessionActions(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    const safeSetHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
      }
    };

    safeSetHandler('play', () => {
      if (this.state.station) {
        void this.playStation(this.state.station);
      }
    });

    safeSetHandler('pause', () => {
      this.audio.pause();
      this.updateState({ status: 'paused' });
      this.syncMediaPlaybackState('paused');
    });

    safeSetHandler('stop', () => {
      this.stop();
    });

    safeSetHandler('previoustrack', () => {
      this.onPrevHandler?.();
    });

    safeSetHandler('nexttrack', () => {
      this.onNextHandler?.();
    });
  }

  private updateMediaMetadata(station: RadioStation): void {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') {
      return;
    }

    const artwork: MediaImage[] = [];
    if (station.favicon && station.favicon.startsWith('https://')) {
      artwork.push({ src: station.favicon, sizes: '256x256', type: 'image/png' });
    }
    artwork.push({ src: './icon.svg', sizes: '512x512', type: 'image/svg+xml' });

    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: station.country || 'WorldTuner Live',
      album: `${station.codec}${station.bitrate ? ` • ${station.bitrate} kbps` : ''}`,
      artwork
    });
  }

  private syncMediaPlaybackState(playbackState: MediaSessionPlaybackState): void {
    if (!('mediaSession' in navigator)) {
      return;
    }
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch {
    }
  }
}

export const radioPlayer = new RadioPlayer();