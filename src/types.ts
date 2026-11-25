export interface RadioStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  bitrate: number;
  codec: string;
  votes: number;
}

export interface CountryOption {
  code: string;
  name: string;
  stationcount: number;
}

export interface TagOption {
  name: string;
  stationcount: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type AppTab = 'tuner' | 'explore' | 'saved';

export interface PlayerState {
  station: RadioStation | null;
  status: PlayerStatus;
  errorMessage: string;
  sleepRemainingSec: number;
}

export interface ExploreFilter {
  query: string;
  tags: string[];
  countryCodes: string[];
}