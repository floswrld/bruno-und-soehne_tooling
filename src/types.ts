// Gemeinsame Typen für App-API, MCP und OAuth.
import type { LiveRaum } from './liveraum';

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_KV: KVNamespace; // OAuth-Clients, -Freigaben und -Tokens (nur als Hash)
  LIVE: DurableObjectNamespace<LiveRaum>; // Live-Raum: Mods und Browser per WebSocket
  SETUP_TOKEN?: string;
  BAUPLAN_SYNC_KEY?: string; // Schlüssel für scripts/bauplan-sync.mjs
};

export type User = {
  id: number;
  username: string;
  display_name: string;
  title: string;
  role: 'admin' | 'user';
  must_change_password: number;
  active: number;
  created_at: string;
};
