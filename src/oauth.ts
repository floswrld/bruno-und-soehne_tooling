// OAuth für den MCP-Zugang: Jeder Mitarbeiter verbindet seine KI-App (ChatGPT, Claude-App, …) selbst.
// Die Bibliothek erledigt das Protokoll (Metadaten, Registrierung, Token, PKCE). Hier stehen nur
// die Zustimmungsseite, die Prüfung pro Anfrage und die Übersicht der Verbindungen.

import {
  AuthorizationError,
  CimdFetchError,
  OAuthAuthorizationServer,
  OAuthResourceServer,
  insufficientScope,
  type ConsentDescription,
} from '@cloudflare/workers-oauth-provider';
import { MCP_KEY_PREFIX, handleMcp, keyOwner } from './mcp';
import type { Env, User } from './types';

const SCOPE = 'board'; // Scrum-Board lesen und bearbeiten, mehr gibt es nicht
const DAY = 86400;

type Props = { userId: number; name?: string; keyId?: number };
type OAuth = { server: OAuthAuthorizationServer<Env>; resource: OAuthResourceServer<Env, Props> };

// Aussteller und Ressource hängen an der Adresse, unter der die App gerade läuft
// (eigene Domain, workers.dev oder lokal). Einmal pro Adresse aufgebaut.
const cache = new Map<string, OAuth>();

export function oauthFor(url: string): OAuth {
  const origin = new URL(url).origin;
  const cached = cache.get(origin);
  if (cached) return cached;

  const mcpUrl = `${origin}/mcp`;
  const server = new OAuthAuthorizationServer<Env>({
    issuer: origin,
    resources: [mcpUrl],
    clientRegistrationEndpoint: '/oauth/register', // ChatGPT, Cursor & Co. registrieren sich selbst
    clientIdMetadataDocumentEnabled: true, // Claude weist sich mit einem veröffentlichten Dokument aus
    scopesSupported: [SCOPE, 'offline_access'],
    // Verbunden bleibt, wer die App mindestens alle 30 Tage benutzt.
    refreshTokenTTL: 30 * DAY,
    refreshTokenIdleTTL: 30 * DAY,
  });

  const resource = new OAuthResourceServer<Env, Props>({
    resourceMetadata: {
      resource: mcpUrl,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      resource_name: 'Bruno & Söhne Scrum-Board',
    },
    requiredScopes: [SCOPE],
    validateToken: (env) => async (res, token) => {
      // MCP-Schlüssel der Geschäftsführung gelten weiter neben OAuth.
      if (token.startsWith(MCP_KEY_PREFIX)) {
        const k = await keyOwner(env.DB, token);
        return k ? { props: { userId: k.id, name: k.display_name, keyId: k.key_id }, audience: res, scope: [SCOPE] } : null;
      }
      const t = await server.validateToken<Props>(res, token, env);
      if (!t) return null;
      // Deaktivierte Mitarbeiter verlieren den Zugang sofort, auch mit noch gültigem Token.
      const u = await env.DB.prepare('SELECT display_name FROM users WHERE id = ? AND active = 1')
        .bind(t.props.userId)
        .first<{ display_name: string }>();
      return u ? { ...t, props: { ...t.props, name: u.display_name } } : null;
    },
    handler: {
      async fetch(request, env, ctx) {
        if (!ctx.auth.scope.includes(SCOPE)) return insufficientScope(ctx.auth, [SCOPE]);
        const { userId, name, keyId } = ctx.props;
        if (keyId) ctx.waitUntil(env.DB.prepare(`UPDATE mcp_keys SET last_used_at = datetime('now') WHERE id = ?`).bind(keyId).run());
        return handleMcp(request, env.DB, { id: userId, display_name: name ?? '', key_id: keyId ?? null, client_id: ctx.auth.clientId ?? null });
      },
    },
  });

  const pair = { server, resource };
  cache.set(origin, pair);
  return pair;
}

// ---------- Zustimmungsseite ----------

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function page(status: number, title: string, body: string, headers = new Headers()) {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(
    `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} – Bruno &amp; Söhne</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="consent-body">
  <main class="consent panel">
    <img src="/favicon.svg" alt="" class="consent-mark">
    <h1>${esc(title)}</h1>
    ${body}
  </main>
</body>
</html>`,
    { status, headers }
  );
}

// Alles, was vom Client kommt (Name, Domain, Rücksprungadresse), ist fremd und wird maskiert.
function consentPage(d: ConsentDescription, handle: string, user: User, headers: Headers) {
  const who = d.clientDomain
    ? `Herausgeber: <b>${esc(d.clientDomain)}</b>`
    : 'Diese App hat sich selbst angemeldet, ihr Name ist nicht überprüft.';
  // Ohne „board“ geht nichts; Refresh-Token nur, wenn die App sie möchte.
  const scopes = [SCOPE, ...(d.scope.includes('offline_access') ? ['offline_access'] : [])];
  return page(
    200,
    'KI-Zugang erlauben?',
    `<p class="lead"><b>${esc(d.clientName)}</b> möchte in deinem Namen das Scrum-Board bearbeiten.</p>
    <p class="small muted">${who}</p>
    <ul class="consent-list">
      <li class="yes">Aufgaben ansehen, anlegen, bearbeiten und verschieben</li>
      <li class="no">Nichts löschen, keine Zeiterfassung, kein Personal</li>
    </ul>
    <p class="small">Angemeldet als <b>${esc(user.display_name)}</b>. Der Zugang geht an <b>${esc(d.redirectHost)}</b>.</p>
    ${
      d.redirectIsLoopback
        ? '<p class="small warn">Der Zugang geht an ein Programm auf diesem Computer. Erlaube das nur, wenn du die Verbindung gerade selbst gestartet hast.</p>'
        : ''
    }
    <form method="post" class="consent-actions">
      <input type="hidden" name="handle" value="${esc(handle)}">
      ${scopes.map((s) => `<input type="hidden" name="scope" value="${esc(s)}">`).join('')}
      <button class="btn btn-ghost" name="decision" value="deny">Ablehnen</button>
      <button class="btn btn-primary" name="decision" value="approve">Erlauben</button>
    </form>
    <p class="small muted">Trennen kannst du die Verbindung jederzeit unter Profil.</p>`,
    headers
  );
}

// Fehler: Zurück zur App nur, wenn die Bibliothek die Rücksprungadresse geprüft hat, sonst hier anzeigen.
function authError(e: unknown): Response {
  if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
  if (e instanceof AuthorizationError || e instanceof CimdFetchError) {
    const why = e instanceof AuthorizationError ? e.description : 'Die App konnte nicht überprüft werden.';
    return page(400, 'Das hat nicht geklappt', `<p>${esc(why)}</p><p class="small muted">Starte die Verbindung in deiner KI-App neu.</p>`);
  }
  throw e;
}

export async function authorizePage(req: Request, env: Env, user: User | null): Promise<Response> {
  const oauth = oauthFor(req.url).server.getOAuthApi(env);
  try {
    const authReq = await oauth.parseAuthRequest(req);
    // Erst anmelden (und ggf. das Einmal-Passwort ersetzen), dann geht es hierher zurück.
    if (!user || user.must_change_password) {
      const url = new URL(req.url);
      return Response.redirect(`${url.origin}/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    }
    const details = await oauth.describeConsent(authReq);
    const consent = await oauth.beginConsent(authReq);
    return consentPage(details, consent.handle, user, consent.headers);
  } catch (e) {
    return authError(e);
  }
}

export async function authorizeDecision(req: Request, env: Env, user: User | null): Promise<Response> {
  const oauth = oauthFor(req.url).server.getOAuthApi(env);
  try {
    const form = await req.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(req, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (!user || user.must_change_password) {
      return page(401, 'Bitte neu anmelden', '<p>Deine Sitzung ist abgelaufen. Starte die Verbindung in deiner KI-App neu.</p>');
    }
    const approved = await oauth.approveConsent(req, handle, { scope: form.getAll('scope').map(String) });
    const client = await oauth.lookupClient(approved.request.clientId);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: String(user.id),
      metadata: { client: client?.clientName || approved.request.clientId },
      scope: approved.request.scope,
      props: { userId: user.id },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (e) {
    return authError(e);
  }
}

// ---------- Verbindungen ----------

export async function listConnections(env: Env, url: string, userId: number) {
  const oauth = oauthFor(url).server.getOAuthApi(env);
  const grants = [];
  let cursor: string | undefined;
  do {
    const r = await oauth.listUserGrants(String(userId), { cursor });
    grants.push(...r.items);
    cursor = r.cursor;
  } while (cursor);
  return grants
    .map((g) => ({ id: g.id, client: String(g.metadata?.client ?? g.clientId), created_at: new Date(g.createdAt * 1000).toISOString() }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function revokeConnection(env: Env, url: string, userId: number, grantId: string) {
  await oauthFor(url).server.getOAuthApi(env).revokeGrant(grantId, String(userId));
}
