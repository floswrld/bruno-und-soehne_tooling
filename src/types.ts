// Gemeinsame Typen für App-API, MCP und OAuth.

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_KV: KVNamespace; // OAuth-Clients, -Freigaben und -Tokens (nur als Hash)
  SETUP_TOKEN?: string;
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
