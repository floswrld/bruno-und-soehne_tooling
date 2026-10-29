// Bruno & Söhne Intranet – Single-Page-App ohne Build-Schritt.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const dialog = $('#dialog');

// ---------- Infrastruktur ----------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.me) {
      state.me = null;
      route();
    }
    throw new ApiError(res.status, data.error || 'Etwas ist schiefgelaufen.');
  }
  return data;
}
const post = (path, body = {}) => api('POST', path, body);
const patch = (path, body) => api('PATCH', path, body);
const del = (path) => api('DELETE', path, {});

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3600);
}

const state = { me: null, users: [], timers: [], dirty: false };

// Rücksprung nach der Anmeldung, nur zur eigenen Zustimmungsseite
const oauthNext = (() => {
  const n = new URLSearchParams(location.search).get('next');
  return n && /^\/authorize\?/.test(n) ? n : null;
})();

function clearTimers() {
  state.timers.forEach(clearInterval);
  state.timers = [];
}

// ---------- Zeit-Helfer ----------

const DAY = 864e5;
const fmtDate = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / DAY + 1) / 7);
}
const secondsOf = (e) => ((e.ended_at ? Date.parse(e.ended_at) : Date.now()) - Date.parse(e.started_at)) / 1000;
function fmtDur(sec) {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}
function hms(sec) {
  const s = Math.max(0, Math.floor(sec));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}
const digitsHtml = (str) => [...str].map((ch) => (ch === ':' ? `<span class="c">:</span>` : `<span class="d">${ch}</span>`)).join('');
function localInput(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const dateInput = (d) => localInput(d).slice(0, 10);
const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// ---------- Icons (Linien, 1.6px) ----------

const ico = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  home: ico('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  board: ico('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>'),
  plan: ico('<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-5h6v5"/><path d="M9 10h6"/>'),
  people: ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c1.8.7 3 2.5 3.5 5.2"/>'),
  user: ico('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>'),
  logout: ico('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>'),
  left: ico('<path d="M15 5l-7 7 7 7"/>'),
  right: ico('<path d="M9 5l7 7-7 7"/>'),
  plus: ico('<path d="M12 5v14M5 12h14"/>'),
  x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: ico('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  stop: ico('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'),
  sub: ico('<path d="M6 4v8a3 3 0 0 0 3 3h10"/><path d="M15 11l4 4-4 4"/>'),
};
const mark = (cls = 'mark') => `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true"><use href="#mark"/></svg>`;

// Titel aus der Firmenhierarchie
const TITLES = [
  'CEO & Patriarch', 'Head of Wasserentzug', 'Chief Cooling Officer', 'Leiter der Eimerlogistik',
  'Senior Redstone Architect', 'Direktor für Seenabbau', 'Dorfbewohner-Beschwichtiger', 'Head of Erzbeschaffung',
  'Aufsichtsrat für Lüfterlärm', 'Junior-Sohn mit Ambitionen', 'Umwelt-Ignoranz-Officer', 'Pressesprecher (Dürre-PR)',
  'Head of Human Rackources', 'Recruiter für Kühlpersonal', 'Loyalitäts-Uptime-Manager', 'Rack-Strategie-Consultant',
  'Senior Kühlungsberater', 'Cloud-Berater (nur Nebel)', 'Latenz-Berater (immer spät)', 'Berater für Abwärme-Ethik',
  'Werkstudent (Kaffee & Kies)', 'Praktikant ohne Spitzhacke', 'Azubi für Pfützenaufsaugen', 'Unbezahlter Eimerträger',
  'Probezeit-Sohn', 'Hilfskraft ohne Stimmrecht',
];
const titleList = `<datalist id="titles">${TITLES.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`;

// ---------- Dialog ----------

function openDialog(html, mount) {
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal(); // ein offener Dialog wird einfach umgeblättert
  $$('[data-close]', dialog).forEach((b) => b.addEventListener('click', () => dialog.close()));
  mount?.(dialog);
  const first = $('input, select, textarea', dialog);
  first?.focus();
}
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});
// Wurde im Dialog schon etwas gespeichert (z. B. Teilaufgaben), beim Schließen neu laden.
dialog.addEventListener('close', () => state.dirty && route());
const dlgHead = (title) => `<div class="dlg-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">${I.x}</button></div>`;

function bindForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.error', form);
    const btn = $('button[type=submit]', form);
    if (err) err.textContent = '';
    btn && (btn.disabled = true);
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (ex) {
      if (err) err.textContent = ex.message;
      else toast(ex.message, true);
    } finally {
      btn && (btn.disabled = false);
    }
  });
}

// ---------- Router ----------

const ROUTES = {
  '': { title: 'Übersicht', icon: 'home', view: viewDashboard },
  zeit: { title: 'Zeiterfassung', icon: 'clock', view: viewTime },
  board: { title: 'Scrum-Board', icon: 'board', view: viewBoard },
  bauplan: { title: 'Bauplan', icon: 'plan', view: viewPlan },
  personal: { title: 'Personal', icon: 'people', view: viewPeople, admin: true },
  profil: { title: 'Profil', icon: 'user', view: viewProfile, hidden: true },
};

async function route() {
  state.dirty = false;
  clearTimers();
  if (dialog.open) dialog.close();
  if (!state.me) {
    try {
      state.me = await api('GET', '/me');
    } catch {
      const setup = await api('GET', '/setup').catch(() => ({ needed: false }));
      return setup.needed ? viewSetup() : viewLogin();
    }
  }
  if (state.me.must_change_password) return viewForcePassword();
  // Kam die Anmeldung von einer KI-App (OAuth), geht es zurück zur Zustimmungsseite.
  if (oauthNext) return location.replace(oauthNext);

  let key = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (!ROUTES[key] || (ROUTES[key].admin && state.me.role !== 'admin')) key = '';
  const r = ROUTES[key];
  document.title = `${r.title} – Bruno & Söhne`;
  renderShell(key);
  const main = $('.main-inner');
  main.innerHTML = `<div class="loading">${mark()}</div>`;
  try {
    state.users = await api('GET', '/users');
    await r.view(main);
  } catch (ex) {
    main.innerHTML = `<div class="panel empty"><b>Das hat nicht geklappt.</b>${esc(ex.message)}</div>`;
  }
  $('.main')?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);

function renderShell(active) {
  const me = state.me;
  const items = Object.entries(ROUTES).filter(([, r]) => !r.hidden && (!r.admin || me.role === 'admin'));
  const link = ([k, r]) =>
    `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ''}>${I[r.icon]}<span>${r.title}</span>${k === 'bauplan' ? '<span class="soon">bald</span>' : ''}</a>`;
  const tab = ([k, r]) => `<a href="#/${k}" ${k === active ? 'aria-current="page"' : ''}>${I[r.icon]}<span>${{ zeit: 'Zeit', board: 'Board' }[k] ?? r.title}</span></a>`;
  const brand = `<a class="brand" href="#/">${mark()}<span class="brand-name">BRUNO<small>&amp; SÖHNE GMBH</small></span></a>`;
  app.innerHTML = `
    <div class="shell">
      <aside class="side"><div class="side-in">
        ${brand}
        <nav class="nav" aria-label="Hauptmenü">${items.map(link).join('')}</nav>
        <div class="side-foot">
          <a href="#/profil" class="avatar" title="Profil" aria-label="Profil">${esc(initials(me.display_name))}</a>
          <div class="who"><b>${esc(me.display_name)}</b><span>${esc(me.title)}</span></div>
          <button class="icon-btn" data-logout aria-label="Abmelden" title="Abmelden">${I.logout}</button>
        </div>
      </div></aside>
      <header class="topbar">
        ${brand}
        <div style="display:flex;gap:4px">
          <a href="#/profil" class="icon-btn" aria-label="Profil">${I.user}</a>
          <button class="icon-btn" data-logout aria-label="Abmelden">${I.logout}</button>
        </div>
      </header>
      <main class="main" tabindex="-1"><div class="main-inner"></div></main>
      <nav class="tabbar" style="--tabs:${items.length}" aria-label="Hauptmenü">${items.map(tab).join('')}</nav>
    </div>`;
  $$('[data-logout]').forEach((b) =>
    b.addEventListener('click', async () => {
      await post('/auth/logout').catch(() => {});
      state.me = null;
      location.hash = '';
      route();
    })
  );
}

// ---------- Anmeldung ----------

function authLayout(inner) {
  app.innerHTML = `
    <div class="auth">
      <section class="auth-art" aria-hidden="true">
        ${mark()}
        <div class="wordmark">BRUNO<small>&amp; SÖHNE GMBH</small></div>
        <p class="motto">Aqua nostra est.<span>Das Wasser gehört uns. Seit 2026.</span></p>
      </section>
      <section class="auth-form"><div class="inner">${inner}</div></section>
    </div>`;
}

function viewLogin() {
  document.title = 'Anmelden – Bruno & Söhne';
  authLayout(`
    <div><h1>Willkommen zurück.</h1><p class="lead">${
      oauthNext ? 'Melde dich an, um deine KI-App mit dem Scrum-Board zu verbinden.' : 'Zugänge vergibt ausschließlich die Geschäftsführung.'
    }</p></div>
    <form class="form" novalidate>
      <div class="field"><label for="u">Benutzername</label><input class="input" id="u" name="username" autocomplete="username" required autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="p">Passwort</label><input class="input" id="p" name="password" type="password" autocomplete="current-password" required></div>
      <p class="error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Anmelden</button>
    </form>`);
  $('#u').focus();
  bindForm($('form'), async (d) => {
    await post('/auth/login', d);
    state.me = null;
    route();
  });
}

function viewSetup() {
  document.title = 'Gründung – Bruno & Söhne';
  authLayout(`
    <div><h1>Firma gründen.</h1><p class="lead">Lege den ersten Zugang an. Er bekommt Admin-Rechte und den Titel „CEO &amp; Patriarch“. Den Gründungsschlüssel hast du beim Deployment als <code>SETUP_TOKEN</code> gesetzt.</p></div>
    <form class="form" novalidate>
      <div class="field"><label for="t">Gründungsschlüssel</label><input class="input" id="t" name="token" type="password" required></div>
      <div class="field"><label for="n">Anzeigename</label><input class="input" id="n" name="display_name" required placeholder="Bruno"></div>
      <div class="field"><label for="u">Benutzername</label><input class="input" id="u" name="username" required autocapitalize="none" spellcheck="false" autocomplete="username"></div>
      <div class="field"><label for="p">Passwort</label><input class="input" id="p" name="password" type="password" required autocomplete="new-password"><span class="hint">Mindestens 10 Zeichen.</span></div>
      <p class="error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Firma gründen</button>
    </form>`);
  bindForm($('form'), async (d) => {
    await post('/setup', d);
    state.me = null;
    location.hash = '';
    route();
  });
}

function passwordForm(withCurrentHint) {
  return `
    <form class="form" novalidate>
      <div class="field"><label for="c">${withCurrentHint ? 'Einmal-Passwort' : 'Aktuelles Passwort'}</label><input class="input" id="c" name="current" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="n1">Neues Passwort</label><input class="input" id="n1" name="next" type="password" autocomplete="new-password" required><span class="hint">Mindestens 10 Zeichen.</span></div>
      <div class="field"><label for="n2">Neues Passwort wiederholen</label><input class="input" id="n2" name="repeat" type="password" autocomplete="new-password" required></div>
      <p class="error" role="alert"></p>
      <button class="btn btn-primary" type="submit">Passwort speichern</button>
    </form>`;
}
async function savePassword(d) {
  if (d.next !== d.repeat) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
  await post('/me/password', { current: d.current, next: d.next });
}

function viewForcePassword() {
  document.title = 'Passwort festlegen – Bruno & Söhne';
  authLayout(`
    <div><h1>Eigenes Passwort festlegen.</h1><p class="lead">Hallo ${esc(state.me.display_name)}. Dein Zugang wurde mit einem Einmal-Passwort angelegt. Ersetze es, bevor es weitergeht.</p></div>
    ${passwordForm(true)}`);
  bindForm($('form'), async (d) => {
    await savePassword(d);
    state.me = null;
    toast('Passwort gespeichert.');
    route();
  });
}

// ---------- Übersicht ----------

function clockPanel(current, tasks) {
  const running = !!current;
  const myTasks = tasks.filter((t) => t.status !== 'done');
  return `
    <section class="clock" aria-label="Stempeluhr">
      <div class="clock-state">${running ? '<span class="pulse"></span>Eingestempelt' : '<span class="idle"></span>Ausgestempelt'}</div>
      <div class="digits" data-digits role="timer" aria-label="Laufende Zeit">${digitsHtml(running ? hms(secondsOf(current)) : '00:00:00')}</div>
      <div class="clock-meta">${
        running
          ? `<span>Seit <b>${fmtTime.format(new Date(current.started_at))} Uhr</b></span>${current.task_title ? `<span>An <b>${esc(current.task_title)}</b></span>` : ''}${current.note ? `<span>${esc(current.note)}</span>` : ''}`
          : `<span>Jede Minute zählt. Die Geschäftsführung sieht alles.</span>`
      }</div>
      <form class="clock-form" data-clock>
        ${
          running
            ? `<button class="btn btn-brass" type="submit">${I.stop}Ausstempeln</button>`
            : `<input class="input" name="note" placeholder="Woran arbeitest du?" maxlength="300" aria-label="Notiz">
               <select class="select" name="task_id" aria-label="Aufgabe"><option value="">Ohne Aufgabe</option>${myTasks
                 .map((t) => `<option value="${t.id}">#${t.id} ${esc(t.title)}</option>`)
                 .join('')}</select>
               <button class="btn btn-brass" type="submit">${I.play}Einstempeln</button>`
        }
      </form>
    </section>`;
}

function bindClock(root, current, onChange) {
  const digits = $('[data-digits]', root);
  if (current) state.timers.push(setInterval(() => (digits.innerHTML = digitsHtml(hms(secondsOf(current)))), 1000));
  bindForm($('[data-clock]', root), async (d) => {
    if (current) {
      await post('/time/stop');
      toast('Ausgestempelt.');
    } else {
      await post('/time/start', { note: d.note, task_id: d.task_id || null });
      toast('Eingestempelt.');
    }
    onChange();
  });
}

async function viewDashboard(main) {
  const ws = startOfWeek();
  const range = `from=${ws.toISOString()}&to=${addDays(ws, 7).toISOString()}`;
  const [current, team, sprints, tasks] = await Promise.all([
    api('GET', '/time/current'),
    api('GET', `/time/team?${range}`),
    api('GET', '/sprints'),
    api('GET', '/tasks'),
  ]);
  const me = state.me;
  const sprint = sprints.find((s) => s.active);
  const mine = tasks.filter((t) => t.assignee_id === me.id && t.status !== 'done' && (!sprint || t.sprint_id === sprint.id));
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Guten Tag' : 'Guten Abend';
  const statusName = { backlog: 'Backlog', todo: 'To do', doing: 'In Arbeit', review: 'Review', done: 'Erledigt' };

  main.innerHTML = `
    <header class="page-head">
      <div><h1>${greet}, ${esc(me.display_name.split(' ')[0])}.</h1><p>${fmtDate.format(new Date())}. Kalenderwoche ${isoWeek(new Date())}.</p></div>
    </header>
    <div class="grid grid-dash">
      <div class="grid" style="align-content:start">
        ${clockPanel(current, tasks.filter((t) => t.assignee_id === me.id))}
        <section class="panel">
          <div class="panel-head"><h2>Meine Aufgaben</h2><a href="#/board" class="small">Zum Board</a></div>
          ${
            mine.length
              ? `<div class="table-wrap"><table><thead><tr><th>Aufgabe</th><th>Spalte</th></tr></thead><tbody>${mine
                  .map((t) => `<tr><td><b>${esc(t.title)}</b> <span class="muted small">#${t.id}${t.parent_id ? ` · Teil von #${t.parent_id}` : ''}</span></td><td><span class="chip">${statusName[t.status]}</span></td></tr>`)
                  .join('')}</tbody></table></div>`
              : `<div class="empty"><b>Nichts zugewiesen.</b>Nimm dir eine Aufgabe vom Board, bevor es jemand bemerkt.</div>`
          }
        </section>
      </div>
      <section class="panel" style="align-self:start">
        <div class="panel-head"><h2>Fleißrangliste</h2><span class="muted small">KW ${isoWeek(new Date())}</span></div>
        ${
          team.length
            ? `<ol class="ranks">${team
                .map(
                  (u, i) => `<li><span class="pos">${i + 1}</span><span class="avatar sm">${esc(initials(u.display_name))}</span>
                  <span class="who"><b>${esc(u.display_name)}</b><span>${esc(u.title)}</span></span>
                  <span class="hrs">${fmtDur(u.seconds)}${u.clocked_in ? '<small>eingestempelt</small>' : ''}</span></li>`
                )
                .join('')}</ol>`
            : `<div class="empty">Noch keine Mitarbeiter.</div>`
        }
        ${sprint ? `<p class="small muted" style="margin:18px 0 0">Aktueller Sprint: <b style="color:var(--ink)">${esc(sprint.name)}</b>${sprint.goal ? `. ${esc(sprint.goal)}` : ''}</p>` : ''}
      </section>
    </div>`;
  bindClock(main, current, route);
}

// ---------- Zeiterfassung ----------

async function viewTime(main) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const ws = params.get('w') ? startOfWeek(new Date(params.get('w') + 'T12:00')) : startOfWeek();
  const isAdmin = state.me.role === 'admin';
  const who = isAdmin ? params.get('u') || String(state.me.id) : String(state.me.id);
  const go = (w, u) => (location.hash = `#/zeit?w=${dateInput(w)}&u=${u}`);

  const [entries, current, tasks] = await Promise.all([
    api('GET', `/time?from=${ws.toISOString()}&to=${addDays(ws, 7).toISOString()}&user=${who}`),
    api('GET', '/time/current'),
    api('GET', '/tasks'),
  ]);

  const perDay = Array.from({ length: 7 }, () => 0);
  for (const e of entries) perDay[(new Date(e.started_at).getDay() + 6) % 7] += secondsOf(e);
  const total = perDay.reduce((a, b) => a + b, 0);
  const maxDay = Math.max(8 * 3600, ...perDay);
  const today = new Date();

  const groups = new Map();
  for (const e of entries) {
    const k = new Date(e.started_at).toDateString();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const showName = who === 'all';
  const canEdit = (e) => e.user_id === state.me.id || isAdmin;
  const userOpts = [
    ...state.users.map((u) => `<option value="${u.id}" ${String(u.id) === who ? 'selected' : ''}>${esc(u.display_name)}</option>`),
    `<option value="all" ${who === 'all' ? 'selected' : ''}>Alle Mitarbeiter</option>`,
  ].join('');

  main.innerHTML = `
    <header class="page-head">
      <div><h1>Zeiterfassung</h1><p>Stempeln, nachtragen, korrigieren. Diese Woche: <b style="color:var(--ink)">${fmtDur(total)}</b>.</p></div>
      <div class="actions">
        ${isAdmin ? `<select class="select" data-who aria-label="Mitarbeiter" style="width:auto">${userOpts}</select>` : ''}
        <button class="btn btn-ink" data-add>${I.plus}Zeit nachtragen</button>
      </div>
    </header>
    <div class="grid grid-dash">
      <div class="grid" style="align-content:start">
        ${clockPanel(current, tasks.filter((t) => t.assignee_id === state.me.id))}
        <section class="panel">
          <div class="panel-head" style="flex-wrap:wrap">
            <h2>Einträge</h2>
            <div class="weeknav">
              <button class="icon-btn" data-prev aria-label="Vorherige Woche">${I.left}</button>
              <span class="label">KW ${isoWeek(ws)}, ${fmtShort.format(ws)} – ${fmtShort.format(addDays(ws, 6))}</span>
              <button class="icon-btn" data-next aria-label="Nächste Woche">${I.right}</button>
            </div>
          </div>
          ${
            entries.length
              ? `<div class="days">${[...groups]
                  .map(
                    ([k, list]) => `<div class="day-group"><h3>${fmtDate.format(new Date(k))}<span>${fmtDur(list.reduce((a, e) => a + secondsOf(e), 0))}</span></h3>
                    ${list
                      .map(
                        (e) => `<div class="entry">
                          <span class="span">${fmtTime.format(new Date(e.started_at))} – ${e.ended_at ? fmtTime.format(new Date(e.ended_at)) : 'läuft'}</span>
                          <span class="what"><div>${esc(e.note) || (e.task_title ? '' : '<span class="muted">Ohne Notiz</span>')}${e.task_title ? `${e.note ? ' · ' : ''}<small>#${e.task_id} ${esc(e.task_title)}</small>` : ''}</div>${showName ? `<small>${esc(e.display_name)}</small>` : ''}</span>
                          <span class="dur">${fmtDur(secondsOf(e))}</span>
                          ${canEdit(e) ? `<button class="btn btn-ghost btn-sm" data-edit="${e.id}">Bearbeiten</button>` : '<span></span>'}
                        </div>`
                      )
                      .join('')}</div>`
                  )
                  .join('')}</div>`
              : `<div class="empty"><b>Keine Einträge in dieser Woche.</b>Stempel ein oder trag Zeit nach.</div>`
          }
        </section>
      </div>
      <section class="panel" style="align-self:start">
        <div class="panel-head"><h2>Wochenverlauf</h2><span class="muted small num">${fmtDur(total)}</span></div>
        <div class="week">${perDay
          .map((s, i) => {
            const d = addDays(ws, i);
            const isToday = d.toDateString() === today.toDateString();
            return `<div class="day ${isToday ? 'today' : ''}"><span class="val">${s ? fmtDur(s).replace(' h', '') : ''}</span><div class="bar-track"><div class="bar" style="height:${(s / maxDay) * 100}%"></div></div><span class="lbl">${WEEKDAYS[i]}</span></div>`;
          })
          .join('')}</div>
        <p class="small muted" style="margin:16px 0 0">Die Balken sind auf einen 8-Stunden-Tag skaliert. Mehr ist erwünscht.</p>
      </section>
    </div>`;

  bindClock(main, current, route);
  $('[data-prev]', main).onclick = () => go(addDays(ws, -7), who);
  $('[data-next]', main).onclick = () => go(addDays(ws, 7), who);
  $('[data-who]', main)?.addEventListener('change', (e) => go(ws, e.target.value));
  $('[data-add]', main).onclick = () => entryDialog(null, tasks);
  $$('[data-edit]', main).forEach((b) => (b.onclick = () => entryDialog(entries.find((e) => e.id === Number(b.dataset.edit)), tasks)));
}

function entryDialog(entry, tasks) {
  const now = new Date();
  const start = entry ? new Date(entry.started_at) : new Date(now.getTime() - 3600e3);
  const end = entry?.ended_at ? new Date(entry.ended_at) : entry ? null : now;
  openDialog(
    `<form class="dlg" novalidate>
      ${dlgHead(entry ? 'Eintrag bearbeiten' : 'Zeit nachtragen')}
      <div class="form">
        <div class="form-row">
          <div class="field"><label for="es">Beginn</label><input class="input" id="es" name="started_at" type="datetime-local" value="${localInput(start)}" required></div>
          <div class="field"><label for="ee">Ende</label><input class="input" id="ee" name="ended_at" type="datetime-local" value="${end ? localInput(end) : ''}" ${entry && !entry.ended_at ? '' : 'required'}>${entry && !entry.ended_at ? '<span class="hint">Leer lassen, solange der Eintrag läuft.</span>' : ''}</div>
        </div>
        <div class="field"><label for="et">Aufgabe</label><select class="select" id="et" name="task_id"><option value="">Ohne Aufgabe</option>${tasks
          .map((t) => `<option value="${t.id}" ${entry?.task_id === t.id ? 'selected' : ''}>#${t.id} ${esc(t.title)}</option>`)
          .join('')}</select></div>
        <div class="field"><label for="en">Notiz</label><input class="input" id="en" name="note" maxlength="300" value="${esc(entry?.note ?? '')}"></div>
        <p class="error" role="alert"></p>
      </div>
      <div class="dlg-foot">
        ${entry ? `<button type="button" class="btn btn-danger" data-delete>Löschen</button><span class="spacer"></span>` : ''}
        <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${entry ? 'Änderungen speichern' : 'Eintrag speichern'}</button>
      </div>
    </form>`,
    (dlg) => {
      bindForm($('form', dlg), async (d) => {
        const body = {
          started_at: new Date(d.started_at).toISOString(),
          ended_at: d.ended_at ? new Date(d.ended_at).toISOString() : null,
          note: d.note,
          task_id: d.task_id || null,
        };
        if (entry) await patch(`/time/${entry.id}`, body);
        else {
          if (!body.ended_at) throw new Error('Bitte ein Ende angeben.');
          await post('/time', body);
        }
        toast(entry ? 'Änderungen gespeichert.' : 'Eintrag gespeichert.');
        route();
      });
      $('[data-delete]', dlg)?.addEventListener('click', async () => {
        if (!confirmInline(dlg, 'Diesen Eintrag wirklich löschen?')) return;
        await del(`/time/${entry.id}`);
        toast('Eintrag gelöscht.');
        route();
      });
    }
  );
}

// Bestätigung ohne Browser-Popup: erster Klick fragt, zweiter Klick löscht.
function confirmInline(root, question) {
  const btn = $('[data-delete]', root);
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.textContent = 'Ja, löschen';
  $('.error', root).textContent = question;
  return false;
}

// ---------- Scrum-Board ----------

const COLUMNS = [
  ['backlog', 'Backlog'],
  ['todo', 'To do'],
  ['doing', 'In Arbeit'],
  ['review', 'Review'],
  ['done', 'Erledigt'],
];
const STATUS_NAME = Object.fromEntries(COLUMNS);

const progress = (done, total) =>
  `<span class="progress${done === total ? ' full' : ''}"><span class="track"><span class="fill" style="width:${(done / total) * 100}%"></span></span><span class="num">${done}/${total}</span></span>`;

// Rückmeldung des Servers zu übergeordneten Aufgaben
function taskNotice(res) {
  if (res?.reopened) toast(`#${res.reopened} ist wieder in Arbeit: Eine Teilaufgabe ist offen.`);
  else if (res?.parent_ready) toast(`Alle Teilaufgaben erledigt. #${res.parent_ready} darf jetzt nach „Erledigt“.`);
}

async function viewBoard(main) {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const sprints = await api('GET', '/sprints');
  const active = sprints.find((s) => s.active);
  // ohne s: aktiver Sprint; s leer: bewusst „Alle Aufgaben“
  const sel = params.has('s') ? params.get('s') : active ? String(active.id) : '';
  const who = params.get('u') || ''; // '' = alle, 'none' = niemand zugewiesen, sonst Benutzer-ID
  const go = (s, u) => (location.hash = `#/board?s=${s}${u ? `&u=${u}` : ''}`);
  const tasks = await api('GET', '/tasks' + (sel ? `?sprint=${sel}` : ''));
  const sprint = sprints.find((s) => String(s.id) === sel);
  const isAdmin = state.me.role === 'admin';
  // Der Filter blendet nur Karten aus; Dialoge sehen weiter alle Aufgaben des Sprints.
  const visible = tasks.filter((t) => !who || (who === 'none' ? !t.assignee_id : t.assignee_id === Number(who)));
  const doneCount = visible.filter((t) => t.status === 'done').length;
  const workers = state.users.filter((u) => u.active || tasks.some((t) => t.assignee_id === u.id));

  // Aufgabe und Teilaufgaben bilden eine Familie, benannt nach der übergeordneten Aufgabe.
  const family = (t) => t.parent_id || (t.sub_total ? t.id : '');
  const card = (t) => `
    <button type="button" class="card${t.parent_id ? ' sub' : ''}" draggable="true" data-id="${t.id}" ${family(t) ? `data-family="${family(t)}"` : ''}
      aria-label="${esc(t.title)}${t.parent_id ? `, Teilaufgabe von #${t.parent_id}` : ''} bearbeiten">
      ${t.parent_id ? `<span class="parent">${I.sub}<span>#${t.parent_id} ${esc(t.parent_title)}</span></span>` : ''}
      <span class="t">${esc(t.title)}</span>
      ${t.sub_total ? progress(t.sub_done, t.sub_total) : ''}
      <span class="meta">
        <span class="key">#${t.id}</span>
        ${t.assignee_id ? `<span class="avatar sm" title="${esc(t.assignee_name)}">${esc(initials(t.assignee_name))}</span>` : '<span class="nobody" title="Niemand zugewiesen"></span>'}
      </span>
    </button>`;

  main.innerHTML = `
    <header class="page-head">
      <div><h1>Scrum-Board</h1><p>Ziehe Karten zwischen die Spalten oder öffne sie, um sie zu bearbeiten.</p></div>
      <div class="actions">
        ${isAdmin ? `<button class="btn btn-ghost" data-sprint-new>Sprint planen</button>${sprint ? `<button class="btn btn-ghost" data-sprint-edit>Sprint bearbeiten</button>` : ''}` : ''}
        <button class="btn btn-ink" data-new="backlog">${I.plus}Neue Aufgabe</button>
      </div>
    </header>
    <div class="board-bar">
      <select class="select" data-sprint aria-label="Sprint auswählen">
        <option value="">Alle Aufgaben</option>
        ${sprints.map((s) => `<option value="${s.id}" ${String(s.id) === sel ? 'selected' : ''}>${esc(s.name)}${s.active ? ' (aktiv)' : ''}</option>`).join('')}
        <option value="none" ${sel === 'none' ? 'selected' : ''}>Ohne Sprint</option>
      </select>
      <select class="select" data-who aria-label="Nach Mitarbeiter filtern">
        <option value="">Alle Mitarbeiter</option>
        ${workers.map((u) => `<option value="${u.id}" ${String(u.id) === who ? 'selected' : ''}>${esc(u.display_name)}${u.id === state.me.id ? ' (ich)' : ''}</option>`).join('')}
        <option value="none" ${who === 'none' ? 'selected' : ''}>Niemand zugewiesen</option>
      </select>
      <div class="sprint-goal">${
        sprint
          ? `<b>${fmtShort.format(new Date(sprint.starts_on))} bis ${fmtShort.format(new Date(sprint.ends_on))}</b>${sprint.goal ? `&ensp;${esc(sprint.goal)}` : ''}`
          : ''
      }</div>
      <span class="chip ok num">${doneCount} / ${visible.length} erledigt</span>
    </div>
    <div class="board">
      ${COLUMNS.map(([k, name]) => {
        const list = visible.filter((t) => t.status === k);
        return `<section class="col" data-status="${k}" aria-label="${name}">
          <div class="col-head"><h2>${name}</h2><span class="count">${list.length}</span></div>
          <div class="col-list">${list.map(card).join('')}</div>
          <button class="add-card" data-new="${k}">Aufgabe hinzufügen</button>
        </section>`;
      }).join('')}
    </div>`;

  $('[data-sprint]', main).onchange = (e) => go(e.target.value, who);
  $('[data-who]', main).onchange = (e) => go(sel, e.target.value);
  // Neue Aufgaben bekommen den gefilterten Mitarbeiter, damit sie nicht gleich verschwinden.
  const filterAssignee = who && who !== 'none' ? Number(who) : null;
  $$('[data-new]', main).forEach((b) => (b.onclick = () => taskDialog(null, b.dataset.new, sprints, sel, tasks, filterAssignee)));
  $('[data-sprint-new]', main)?.addEventListener('click', () => sprintDialog(null));
  $('[data-sprint-edit]', main)?.addEventListener('click', () => sprintDialog(sprint));
  $$('.card', main).forEach((c) => (c.onclick = () => taskDialog(tasks.find((t) => t.id === Number(c.dataset.id)), null, sprints, sel, tasks)));

  // Beim Überfahren die ganze Familie hervorheben
  $$('.card[data-family]', main).forEach((c) => {
    const kin = (on) => $$(`.card[data-family="${c.dataset.family}"]`, main).forEach((k) => k.classList.toggle('kin', on));
    c.addEventListener('mouseenter', () => kin(true));
    c.addEventListener('mouseleave', () => kin(false));
  });

  // Drag & Drop: mit der Maus über HTML5, per Finger über langes Drücken (siehe unten)
  let dragId = null;

  async function dropOn(col, clientY) {
    const status = col.dataset.status;
    const dragged = tasks.find((t) => t.id === dragId);
    if (status === 'done' && dragged.status !== 'done' && dragged.sub_done < dragged.sub_total) {
      toast(`Erst alle Teilaufgaben erledigen (${dragged.sub_done}/${dragged.sub_total}).`, true);
      return;
    }
    const others = $$('.card', col).filter((c) => Number(c.dataset.id) !== dragId);
    const pos = (id) => tasks.find((t) => t.id === Number(id)).position;
    const after = others.findIndex((c) => clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
    let position;
    if (!others.length) position = 1;
    else if (after === -1) position = pos(others.at(-1).dataset.id) + 1;
    else if (after === 0) position = pos(others[0].dataset.id) - 1;
    else position = (pos(others[after - 1].dataset.id) + pos(others[after].dataset.id)) / 2;

    // sofort umhängen, dann speichern
    const el = $(`.card[data-id="${dragId}"]`, main);
    const listEl = $('.col-list', col);
    after === -1 ? listEl.append(el) : listEl.insertBefore(el, others[after]);
    try {
      const res = await patch(`/tasks/${dragId}`, { status, position });
      if (status === 'done') toast('Erledigt. Bruno ist (fast) zufrieden.');
      taskNotice(res);
    } catch (ex) {
      toast(ex.message, true);
    }
    route();
  }

  // Handys kennen kein HTML5-Drag & Drop. Langes Drücken hebt die Karte an, danach folgt sie
  // dem Finger. Ein kurzer Wisch scrollt weiterhin ganz normal.
  const board = $('.board', main);
  const touch = { timer: 0, card: null, start: null, finger: null, offset: null, ghost: null, over: null, frame: 0, moved: false };

  const follow = () => {
    const { x, y } = touch.finger;
    touch.ghost.style.transform = `translate(${x - touch.offset.x}px, ${y - touch.offset.y}px) rotate(2deg)`;
    // Zwischen den Spalten und im Rand (wo man zum Scrollen hält) bleibt die letzte Spalte das Ziel.
    const col = document.elementFromPoint(x, y)?.closest('.col');
    if (!col || col === touch.over) return;
    touch.over?.classList.remove('over');
    col?.classList.add('over');
    touch.over = col;
  };
  // Am Rand entlang: Board seitlich, Seite nach oben oder unten weiterschieben
  const autoScroll = () => {
    if (touch.moved) {
      const { x, y } = touch.finger;
      const b = board.getBoundingClientRect();
      if (x < b.left + 48) board.scrollLeft -= 12;
      else if (x > b.right - 48) board.scrollLeft += 12;
      if (y < 80) window.scrollBy(0, -12);
      else if (y > innerHeight - 110) window.scrollBy(0, 12);
      follow();
    }
    touch.frame = requestAnimationFrame(autoScroll);
  };
  const lift = () => {
    const c = touch.card;
    const r = c.getBoundingClientRect();
    dragId = Number(c.dataset.id);
    touch.offset = { x: touch.start.x - r.left, y: touch.start.y - r.top };
    touch.ghost = c.cloneNode(true);
    touch.ghost.classList.add('ghost');
    touch.ghost.style.width = r.width + 'px';
    document.body.append(touch.ghost);
    c.classList.add('dragging');
    board.style.scrollSnapType = 'none'; // sonst schnappt das Board beim Seitwärtsschieben zurück
    navigator.vibrate?.(12);
    follow();
    touch.frame = requestAnimationFrame(autoScroll);
  };
  // Räumt auf und liefert die Zielspalte, falls die Karte wirklich gezogen wurde.
  const endTouch = () => {
    clearTimeout(touch.timer);
    cancelAnimationFrame(touch.frame);
    const target = touch.ghost && touch.moved ? touch.over : null;
    touch.ghost?.remove();
    touch.over?.classList.remove('over');
    touch.card?.classList.remove('dragging');
    board.style.scrollSnapType = '';
    Object.assign(touch, { timer: 0, card: null, ghost: null, over: null, frame: 0, moved: false });
    return target;
  };

  $$('.card', main).forEach((c) => {
    c.addEventListener('dragstart', (e) => {
      // Manche Handys starten beim langen Drücken auch HTML5-Drag. Das übernimmt hier der Touch-Code.
      if (touch.card) return e.preventDefault();
      dragId = Number(c.dataset.id);
      c.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragId));
    });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));

    c.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length !== 1) return endTouch();
        const p = e.touches[0];
        touch.card = c;
        touch.start = touch.finger = { x: p.clientX, y: p.clientY };
        touch.timer = setTimeout(lift, 350);
      },
      { passive: true }
    );
    c.addEventListener(
      'touchmove',
      (e) => {
        if (!touch.card) return;
        const p = e.touches[0];
        touch.finger = { x: p.clientX, y: p.clientY };
        if (!touch.ghost) {
          // Bewegung vor dem Anheben war ein Wisch zum Scrollen
          if (Math.hypot(p.clientX - touch.start.x, p.clientY - touch.start.y) > 8) endTouch();
          return;
        }
        e.preventDefault(); // Seite nicht mitscrollen, solange die Karte am Finger hängt
        touch.moved = true;
        follow();
      },
      { passive: false }
    );
    c.addEventListener('touchend', (e) => {
      const lifted = !!touch.ghost;
      const y = touch.finger?.y;
      const target = endTouch();
      if (!lifted) return;
      e.preventDefault(); // kein Klick hinterher, der den Dialog öffnet
      if (target) dropOn(target, y);
      else dragId = null;
    });
    c.addEventListener('touchcancel', endTouch);
    c.addEventListener('contextmenu', (e) => touch.card && e.preventDefault());
  });

  $$('.col', main).forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('over');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('over');
    });
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('over');
      if (dragId) dropOn(col, e.clientY);
    });
  });
}

// Die Spalte wird nur per Drag & Drop geändert; neue Aufgaben landen in der Spalte, aus der sie angelegt wurden.
function taskDialog(task, status, sprints, selSprint, tasks, defaultAssignee = null) {
  const users = state.users.filter((u) => u.active);
  const defaultSprint = task ? task.sprint_id : selSprint && selSprint !== 'none' ? Number(selSprint) : null;
  const assignee = task ? task.assignee_id : defaultAssignee;
  const canDelete = task && (task.created_by === state.me.id || state.me.role === 'admin');
  const isSub = !!task?.parent_id;
  let subs = task && !isSub ? tasks.filter((t) => t.parent_id === task.id) : [];
  // Nur eine Ebene: Wer eigene Teilaufgaben hat, kann selbst keine werden.
  const parents = subs.length ? [] : tasks.filter((t) => !t.parent_id && t.id !== task?.id);
  if (isSub && !parents.some((p) => p.id === task.parent_id)) parents.unshift({ id: task.parent_id, title: task.parent_title, sprint_id: task.sprint_id });
  const parent = isSub ? parents.find((p) => p.id === task.parent_id) : null;
  const parentRecord = isSub ? tasks.find((t) => t.id === task.parent_id) : null;

  openDialog(
    `<form class="dlg" novalidate>
      ${dlgHead(task ? `${isSub ? 'Teilaufgabe' : 'Aufgabe'} #${task.id}` : 'Neue Aufgabe')}
      ${
        isSub
          ? `<p class="sub-of">${I.sub}<span>Teil von ${
              parentRecord ? `<button type="button" class="link" data-open-parent>#${parent.id} ${esc(parent.title)}</button>` : `#${parent.id} ${esc(parent.title)}`
            }</span></p>`
          : ''
      }
      <div class="form">
        <div class="field"><label for="tt">Titel</label><input class="input" id="tt" name="title" maxlength="140" required value="${esc(task?.title ?? '')}"></div>
        <div class="field"><label for="td">Beschreibung</label><textarea class="textarea" id="td" name="description" maxlength="4000">${esc(task?.description ?? '')}</textarea></div>
        ${
          subs.length
            ? ''
            : `<div class="field"><label for="tpa">Teil von</label><select class="select" id="tpa" name="parent_id"><option value="">Keiner anderen Aufgabe</option>${parents
                .map((p) => `<option value="${p.id}" ${task?.parent_id === p.id ? 'selected' : ''}>#${p.id} ${esc(p.title)}</option>`)
                .join('')}</select></div>`
        }
        <div class="form-row">
          <div class="field"><label for="ta">Zuständig</label><select class="select" id="ta" name="assignee_id"><option value="">Niemand</option>${users
            .map((u) => `<option value="${u.id}" ${assignee === u.id ? 'selected' : ''}>${esc(u.display_name)}</option>`)
            .join('')}</select></div>
          <div class="field"><label for="tsp">Sprint</label><select class="select" id="tsp" name="sprint_id"><option value="">Ohne Sprint</option>${sprints
            .map((s) => `<option value="${s.id}" ${defaultSprint === s.id ? 'selected' : ''}>${esc(s.name)}</option>`)
            .join('')}</select><span class="hint" data-sprint-hint hidden>Wie die übergeordnete Aufgabe.</span></div>
        </div>
        ${
          task && !isSub
            ? `<section class="subs" aria-label="Teilaufgaben">
                <div class="subs-head"><h3>Teilaufgaben</h3><span class="small muted num" data-subs-count></span></div>
                <div data-subs-progress></div>
                <ul class="sub-list" data-subs-list></ul>
                <div class="sub-add">
                  <input class="input" data-sub-title maxlength="140" placeholder="Neue Teilaufgabe" aria-label="Neue Teilaufgabe">
                  <button type="button" class="btn btn-ghost btn-sm" data-sub-add>${I.plus}Hinzufügen</button>
                </div>
              </section>`
            : ''
        }
        <p class="error" role="alert"></p>
      </div>
      <div class="dlg-foot">
        ${canDelete ? `<button type="button" class="btn btn-danger" data-delete>Löschen</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${task ? 'Änderungen speichern' : 'Aufgabe anlegen'}</button>
      </div>
    </form>`,
    (dlg) => {
      bindForm($('form', dlg), async (d) => {
        const body = { ...d, assignee_id: d.assignee_id || null, sprint_id: d.sprint_id || null, parent_id: d.parent_id || null };
        const res = task ? await patch(`/tasks/${task.id}`, body) : await post('/tasks', { ...body, status });
        toast(task ? 'Änderungen gespeichert.' : 'Aufgabe angelegt.');
        taskNotice(res);
        route();
      });
      $('[data-delete]', dlg)?.addEventListener('click', async () => {
        const q = subs.length ? `Diese Aufgabe und ihre ${subs.length} Teilaufgaben wirklich löschen?` : 'Diese Aufgabe wirklich löschen?';
        if (!confirmInline(dlg, q)) return;
        await del(`/tasks/${task.id}`);
        toast('Aufgabe gelöscht.');
        route();
      });
      $('[data-open-parent]', dlg)?.addEventListener('click', () => taskDialog(parentRecord, null, sprints, selSprint, tasks));

      // Beschreibung wächst mit dem Text mit und lässt sich zusätzlich von Hand größer ziehen.
      const desc = $('#td', dlg);
      const grow = (limit) => {
        if (desc.scrollHeight <= desc.clientHeight) return;
        desc.style.height = Math.min(desc.scrollHeight + 2, limit) + 'px';
      };
      grow(window.innerHeight * 0.5);
      desc.addEventListener('input', () => grow(Infinity));

      // Teilaufgaben laufen im Sprint der übergeordneten Aufgabe mit.
      const parentSel = $('#tpa', dlg);
      const sprintSel = $('#tsp', dlg);
      const syncSprint = () => {
        const p = parents.find((x) => x.id === Number(parentSel.value));
        sprintSel.disabled = !!p;
        if (p) sprintSel.value = p.sprint_id ?? '';
        $('[data-sprint-hint]', dlg).hidden = !p;
      };
      if (parentSel) {
        parentSel.addEventListener('change', syncSprint);
        syncSprint();
      }

      if (task && !isSub) mountSubtasks(dlg, task, () => subs, (list) => (subs = list), tasks, (s) => taskDialog(s, null, sprints, selSprint, tasks));
    }
  );
}

// Liste der Teilaufgaben im Aufgaben-Dialog. Neue werden sofort gespeichert; ihren Status ändert man auf dem Board.
function mountSubtasks(dlg, task, getSubs, setSubs, tasks, openSub) {
  const list = $('[data-subs-list]', dlg);
  const input = $('[data-sub-title]', dlg);
  const addBtn = $('[data-sub-add]', dlg);

  const render = () => {
    const subs = getSubs();
    const done = subs.filter((s) => s.status === 'done').length;
    $('[data-subs-count]', dlg).textContent = subs.length ? `${done} von ${subs.length} erledigt` : '';
    $('[data-subs-progress]', dlg).innerHTML = subs.length ? progress(done, subs.length) : '';
    list.innerHTML = subs.length
      ? subs
          .map(
            (s) => `<li class="${s.status === 'done' ? 'done' : ''}">
              <button type="button" class="sub-open" data-open-sub="${s.id}">${esc(s.title)}</button>
              <span class="chip${s.status === 'done' ? ' ok' : ''}">${STATUS_NAME[s.status]}</span>
              ${s.assignee_id ? `<span class="avatar sm" title="${esc(s.assignee_name)}">${esc(initials(s.assignee_name))}</span>` : '<span></span>'}
            </li>`
          )
          .join('')
      : `<li class="none small muted">Noch keine. Zerlege die Aufgabe in Schritte, die man an einem Tag schafft.</li>`;
  };

  const refresh = async () => {
    const fresh = await api('GET', `/tasks?parent=${task.id}`);
    setSubs(fresh);
    tasks.splice(0, tasks.length, ...tasks.filter((t) => t.parent_id !== task.id), ...fresh);
    render();
  };

  const afterChange = async (res) => {
    state.dirty = true;
    taskNotice(res);
    if (res?.reopened === task.id) task.status = 'doing';
    await refresh();
  };

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-sub]');
    if (b) openSub(getSubs().find((s) => s.id === Number(b.dataset.openSub)));
  });

  const add = async () => {
    const title = input.value.trim();
    if (!title) return input.focus();
    addBtn.disabled = true;
    try {
      const res = await post('/tasks', { title, parent_id: task.id, status: task.status === 'backlog' ? 'backlog' : 'todo' });
      input.value = '';
      await afterChange(res);
      input.focus();
    } catch (ex) {
      toast(ex.message, true);
    } finally {
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', add);
  // Enter legt die Teilaufgabe an, statt das ganze Formular abzuschicken.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  render();
}

function sprintDialog(sprint) {
  const s = sprint?.starts_on ?? dateInput(new Date());
  const e = sprint?.ends_on ?? dateInput(addDays(new Date(), 13));
  openDialog(
    `<form class="dlg" novalidate>
      ${dlgHead(sprint ? 'Sprint bearbeiten' : 'Sprint planen')}
      <div class="form">
        <div class="field"><label for="sn">Name</label><input class="input" id="sn" name="name" required maxlength="60" value="${esc(sprint?.name ?? '')}" placeholder="Sprint 1: Fundament"></div>
        <div class="field"><label for="sg">Sprintziel</label><input class="input" id="sg" name="goal" maxlength="300" value="${esc(sprint?.goal ?? '')}" placeholder="Der erste Fluss ist trockengelegt."></div>
        <div class="form-row">
          <div class="field"><label for="ss">Start</label><input class="input" id="ss" name="starts_on" type="date" value="${s}" required></div>
          <div class="field"><label for="se">Ende</label><input class="input" id="se" name="ends_on" type="date" value="${e}" required></div>
        </div>
        <label style="display:flex;gap:10px;align-items:center;font-weight:500"><input type="checkbox" name="active" ${!sprint || sprint.active ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--bordeaux)"> Als aktiven Sprint setzen</label>
        <p class="error" role="alert"></p>
      </div>
      <div class="dlg-foot">
        <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${sprint ? 'Änderungen speichern' : 'Sprint anlegen'}</button>
      </div>
    </form>`,
    (dlg) =>
      bindForm($('form', dlg), async (d) => {
        const body = { ...d, active: !!d.active };
        let id = sprint?.id;
        if (sprint) await patch(`/sprints/${sprint.id}`, body);
        else id = (await post('/sprints', body)).id;
        toast(sprint ? 'Änderungen gespeichert.' : 'Sprint angelegt.');
        location.hash = `#/board?s=${id}`;
        route();
      })
  );
}

// ---------- Bauplan ----------

async function viewPlan(main) {
  main.innerHTML = `
    <header class="page-head"><div><h1>Bauplan</h1><p>Das Rechenzentrum, Block für Block.</p></div></header>
    <section class="blueprint">
      <svg class="plan" viewBox="0 0 420 300" fill="none" stroke="#DCE8F4" stroke-width="1.4" aria-hidden="true">
        <rect x="20" y="40" width="380" height="220"/>
        <rect x="20" y="40" width="120" height="220" stroke-dasharray="4 4"/>
        ${Array.from({ length: 6 }, (_, i) => `<rect x="${170 + (i % 3) * 72}" y="${70 + Math.floor(i / 3) * 100}" width="52" height="70"/>${[0, 1, 2, 3].map((j) => `<line x1="${176 + (i % 3) * 72}" y1="${82 + j * 14 + Math.floor(i / 3) * 100}" x2="${216 + (i % 3) * 72}" y2="${82 + j * 14 + Math.floor(i / 3) * 100}"/>`).join('')}`).join('')}
        <path d="M80 260v26M20 286h380" /><path d="M20 280v12M400 280v12"/>
        <circle cx="80" cy="150" r="34"/><path d="M80 116v68M46 150h68"/>
        <text x="210" y="298" fill="#DCE8F4" stroke="none" font-size="11" font-family="Hanken Grotesk, sans-serif" text-anchor="middle">1000 Blöcke</text>
        <text x="80" y="210" fill="#DCE8F4" stroke="none" font-size="11" font-family="Hanken Grotesk, sans-serif" text-anchor="middle">Kühlung</text>
      </svg>
      <h2>Hier entsteht der Bauplan.</h2>
      <p>Bauabschnitte, Materiallisten und wer welchen Block verantwortet. Bis es so weit ist, planen wir die Arbeit auf dem Scrum-Board.</p>
      <div><a class="btn btn-brass" href="#/board">Zum Scrum-Board</a></div>
    </section>`;
}

// ---------- Personal (Admin) ----------

async function viewPeople(main) {
  const users = state.users;
  main.innerHTML = `
    <header class="page-head">
      <div><h1>Personal</h1><p>Zugänge anlegen, Titel vergeben, Rechte entziehen. Selbst registrieren kann sich niemand.</p></div>
      <div class="actions"><button class="btn btn-primary" data-new>${I.plus}Mitarbeiter anlegen</button></div>
    </header>
    <section class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>Mitarbeiter</th><th>Benutzername</th><th>Rolle</th><th>Status</th><th></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
            <td><div class="person"><span class="avatar">${esc(initials(u.display_name))}</span><div><b>${esc(u.display_name)}</b><span>${esc(u.title)}</span></div></div></td>
            <td>${esc(u.username)}</td>
            <td>${u.role === 'admin' ? '<span class="chip admin">Geschäftsführung</span>' : '<span class="chip">Belegschaft</span>'}</td>
            <td>${!u.active ? '<span class="chip off">Deaktiviert</span>' : u.must_change_password ? '<span class="chip">Wartet auf Erstanmeldung</span>' : '<span class="chip ok"><span class="dot"></span>Aktiv</span>'}</td>
            <td style="text-align:right"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">Bearbeiten</button></td>
          </tr>`
          )
          .join('')}</tbody>
      </table></div>
    </section>`;
  $('[data-new]', main).onclick = () => userDialog(null);
  $$('[data-edit]', main).forEach((b) => (b.onclick = () => userDialog(users.find((u) => u.id === Number(b.dataset.edit)))));
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopiert.');
  } catch {
    toast('Kopieren nicht möglich. Bitte markieren und abschreiben.', true);
  }
}

function showSecret(name, pw) {
  openDialog(
    `<div class="dlg">
      ${dlgHead('Einmal-Passwort')}
      <p style="margin:0">Gib ${esc(name)} dieses Passwort. Es wird nur jetzt angezeigt. Bei der ersten Anmeldung muss es ersetzt werden.</p>
      <div class="secret">${esc(pw)}</div>
      <div class="dlg-foot"><button class="btn btn-ghost" data-copy>Kopieren</button><button class="btn btn-primary" data-close>Fertig</button></div>
    </div>`,
    (dlg) => {
      $('[data-copy]', dlg).onclick = () => copy(pw);
      dlg.addEventListener('close', () => route(), { once: true });
    }
  );
}

// Neuer MCP-Schlüssel: einmal anzeigen, mit fertiger Einrichtung zum Kopieren
function showMcpKey(u, key) {
  const url = `${location.origin}/mcp`;
  const cmd = `claude mcp add --transport http bruno-board ${url} --header "Authorization: Bearer ${key}"`;
  const config = JSON.stringify({ mcpServers: { 'bruno-board': { type: 'http', url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2);
  openDialog(
    `<div class="dlg">
      ${dlgHead('MCP-Schlüssel')}
      <p style="margin:0">Für ${esc(u.display_name)}. Der Schlüssel wird nur jetzt angezeigt. Ein KI-Agent kann damit in ${esc(u.display_name)}s Namen das Scrum-Board lesen und bearbeiten, aber nichts löschen und nichts anderes sehen.</p>
      <div class="secret key">${esc(key)}</div>
      <div class="field"><label>Claude Code</label><pre class="code">${esc(cmd)}</pre></div>
      <div class="field"><label>Andere Programme (Cursor, VS Code, …)</label><pre class="code">${esc(config)}</pre><span class="hint">Adresse: ${esc(url)}, Kopfzeile <code>Authorization: Bearer …</code></span></div>
      <div class="dlg-foot">
        <button class="btn btn-ghost" data-copy="key">Schlüssel kopieren</button>
        <button class="btn btn-ghost" data-copy="cmd">Befehl kopieren</button>
        <button class="btn btn-primary" data-close>Fertig</button>
      </div>
    </div>`,
    (dlg) => {
      $$('[data-copy]', dlg).forEach((b) => (b.onclick = () => copy(b.dataset.copy === 'key' ? key : cmd)));
      dlg.addEventListener('close', () => route(), { once: true });
    }
  );
}

const sqlDate = (s) => new Date(s.replace(' ', 'T') + 'Z');
const fmtWhen = (s) => (s ? `${fmtShort.format(sqlDate(s))}, ${fmtTime.format(sqlDate(s))}` : 'nie');

// MCP-Schlüssel eines Mitarbeiters im Bearbeiten-Dialog (nur Geschäftsführung sieht den Dialog)
// Per OAuth verbundene KI-Apps (eigene im Profil, die eines Mitarbeiters im Personal-Dialog)
async function mountConnections(list, base) {
  const render = async () => {
    const conns = await api('GET', `${base}/connections`);
    list.innerHTML = conns.length
      ? conns
          .map(
            (g) => `<li>
              <span class="key-name">${esc(g.client)}</span>
              <span class="small muted">seit ${fmtShort.format(new Date(g.created_at))}</span>
              <button type="button" class="btn btn-danger btn-sm" data-disconnect="${esc(g.id)}">Trennen</button>
            </li>`
          )
          .join('')
      : `<li class="none small muted">Keine KI-App verbunden.</li>`;
  };
  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-disconnect]');
    if (!b) return;
    // erster Klick fragt, zweiter trennt
    if (!b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = 'Wirklich?';
      return;
    }
    b.disabled = true;
    try {
      await del(`${base}/connections/${encodeURIComponent(b.dataset.disconnect)}`);
      toast('Getrennt. Die App hat ab sofort keinen Zugang mehr.');
      await render();
    } catch (ex) {
      toast(ex.message, true);
      b.disabled = false;
    }
  });
  try {
    await render();
  } catch (ex) {
    list.innerHTML = `<li class="none small muted">${esc(ex.message)}</li>`;
  }
}

async function mountMcpKeys(dlg, u) {
  const list = $('[data-key-list]', dlg);
  const label = $('[data-key-label]', dlg);
  const addBtn = $('[data-key-add]', dlg);

  const render = async () => {
    const keys = await api('GET', `/users/${u.id}/mcp-keys`);
    list.innerHTML = keys.length
      ? keys
          .map(
            (k) => `<li>
              <span class="key-name">${esc(k.label || 'Ohne Bezeichnung')} <span class="muted">…${esc(k.hint)}</span></span>
              <span class="small muted">Zuletzt: ${fmtWhen(k.last_used_at)}</span>
              <button type="button" class="btn btn-danger btn-sm" data-revoke="${k.id}">Widerrufen</button>
            </li>`
          )
          .join('')
      : `<li class="none small muted">Noch keiner. Mit einem Schlüssel kann ein KI-Agent das Scrum-Board bearbeiten, sonst nichts.</li>`;
  };

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-revoke]');
    if (!b) return;
    // erster Klick fragt, zweiter widerruft
    if (!b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = 'Wirklich?';
      return;
    }
    b.disabled = true;
    try {
      await del(`/users/${u.id}/mcp-keys/${b.dataset.revoke}`);
      toast('Schlüssel widerrufen. Der Agent hat ab sofort keinen Zugang mehr.');
      await render();
    } catch (ex) {
      toast(ex.message, true);
      b.disabled = false;
    }
  });

  const add = async () => {
    addBtn.disabled = true;
    try {
      const res = await post(`/users/${u.id}/mcp-keys`, { label: label.value });
      showMcpKey(u, res.key);
    } catch (ex) {
      toast(ex.message, true);
      addBtn.disabled = false;
    }
  };
  addBtn.addEventListener('click', add);
  // Enter erstellt den Schlüssel, statt das ganze Formular abzuschicken.
  label.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  try {
    await render();
  } catch (ex) {
    list.innerHTML = `<li class="none small muted">${esc(ex.message)}</li>`;
  }
}

function userDialog(u) {
  const self = u?.id === state.me.id;
  openDialog(
    `<form class="dlg" novalidate>
      ${dlgHead(u ? u.display_name : 'Mitarbeiter anlegen')}
      <div class="form">
        <div class="form-row">
          <div class="field"><label for="ud">Anzeigename</label><input class="input" id="ud" name="display_name" required maxlength="60" value="${esc(u?.display_name ?? '')}"></div>
          <div class="field"><label for="uu">Benutzername</label><input class="input" id="uu" name="username" ${u ? 'disabled' : 'required'} maxlength="32" autocapitalize="none" spellcheck="false" value="${esc(u?.username ?? '')}">${u ? '' : '<span class="hint">a–z, 0–9, Punkt, Bindestrich. Nicht änderbar.</span>'}</div>
        </div>
        <div class="field"><label for="uti">Titel</label><input class="input" id="uti" name="title" list="titles" maxlength="40" value="${esc(u?.title ?? 'Unbezahlter Eimerträger')}"><span class="hint">Aus der Liste wählen oder frei erfinden.</span>${titleList}</div>
        <div class="form-row">
          <div class="field"><label for="ur">Rolle</label><select class="select" id="ur" name="role" ${self ? 'disabled' : ''}><option value="user">Belegschaft</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Geschäftsführung (Admin)</option></select></div>
          ${u ? `<div class="field"><label for="ua">Zugang</label><select class="select" id="ua" name="active" ${self ? 'disabled' : ''}><option value="1">Aktiv</option><option value="0" ${!u.active ? 'selected' : ''}>Deaktiviert</option></select></div>` : ''}
        </div>
        ${
          u?.active
            ? `<section class="subs" aria-label="MCP-Schlüssel">
                <div class="subs-head"><h3>KI-Agenten (MCP)</h3><span class="small muted">nur Scrum-Board, ohne Löschen</span></div>
                <ul class="sub-list keys" data-key-list><li class="none small muted">Lädt …</li></ul>
                <div class="sub-add">
                  <input class="input" data-key-label maxlength="60" placeholder="Bezeichnung, z. B. Claude Code Laptop" aria-label="Bezeichnung des neuen Schlüssels">
                  <button type="button" class="btn btn-ghost btn-sm" data-key-add>${I.plus}Schlüssel</button>
                </div>
                <div class="subs-head"><h3>Selbst verbundene KI-Apps</h3><span class="small muted">per Anmeldung</span></div>
                <ul class="sub-list keys" data-conn-list><li class="none small muted">Lädt …</li></ul>
              </section>`
            : ''
        }
        <p class="error" role="alert"></p>
      </div>
      <div class="dlg-foot">
        ${u ? `<button type="button" class="btn btn-ghost" data-reset>Passwort zurücksetzen</button><span class="spacer"></span>` : ''}
        <button type="button" class="btn btn-ghost" data-close>Abbrechen</button>
        <button type="submit" class="btn btn-primary">${u ? 'Änderungen speichern' : 'Zugang anlegen'}</button>
      </div>
    </form>`,
    (dlg) => {
      bindForm($('form', dlg), async (d) => {
        if (u) {
          const body = { display_name: d.display_name, title: d.title };
          if (!self) Object.assign(body, { role: d.role, active: d.active === '1' });
          await patch(`/users/${u.id}`, body);
          if (self) state.me = null;
          toast('Änderungen gespeichert.');
          route();
        } else {
          const res = await post('/users', d);
          showSecret(d.display_name, res.temp_password);
        }
      });
      $('[data-reset]', dlg)?.addEventListener('click', async () => {
        try {
          const res = await post(`/users/${u.id}/reset-password`);
          showSecret(u.display_name, res.temp_password);
        } catch (ex) {
          $('.error', dlg).textContent = ex.message;
        }
      });
      if (u?.active) {
        mountMcpKeys(dlg, u);
        mountConnections($('[data-conn-list]', dlg), `/users/${u.id}`);
      }
    }
  );
}

// ---------- Profil ----------

async function viewProfile(main) {
  const me = state.me;
  main.innerHTML = `
    <header class="page-head"><div><h1>${esc(me.display_name)}</h1><p>${esc(me.title)}. ${me.role === 'admin' ? 'Geschäftsführung.' : 'Belegschaft.'} Den Titel vergibt die Geschäftsführung.</p></div></header>
    <div class="grid" style="max-width:520px">
      <section class="panel">
        <div class="panel-head"><h2>Passwort ändern</h2></div>
        ${passwordForm(false)}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>KI-Apps</h2><span class="small muted">nur Scrum-Board</span></div>
        <p class="small muted" style="margin:0 0 12px">ChatGPT, die Claude-App und andere KI-Apps können in deinem Namen das Scrum-Board bearbeiten. Lege in der App einen eigenen Connector (MCP) mit dieser Adresse an und erlaube den Zugriff, wenn du gefragt wirst. Löschen kann die App nichts.</p>
        <div class="copy-row"><code class="code">${esc(location.origin)}/mcp</code><button type="button" class="btn btn-ghost btn-sm" data-copy-url>Kopieren</button></div>
        <div class="howto">
          <details>
            <summary>Claude (Web, Desktop, Handy)</summary>
            <ol>
              <li>Auf claude.ai: <b>Customize → Connectors → Add custom connector</b>.</li>
              <li>Name, z. B. „Bruno-Board“, und die Adresse oben einfügen, <b>Add</b>.</li>
              <li><b>Connect</b>, hier anmelden und <b>Erlauben</b>.</li>
            </ol>
            <p>Gilt danach auch in der Desktop- und Handy-App.</p>
          </details>
          <details>
            <summary>ChatGPT</summary>
            <ol>
              <li>In den Einstellungen unter <b>Apps</b> den <b>Developer Mode</b> einschalten.</li>
              <li>Eine eigene App anlegen: Adresse oben einfügen, Anmeldung <b>OAuth</b>.</li>
              <li>Hier anmelden und <b>Erlauben</b>.</li>
            </ol>
            <p>Developer Mode gibt es nicht in jedem ChatGPT-Tarif, und die Menünamen ändern sich öfter.</p>
          </details>
          <details>
            <summary>Claude Code</summary>
            <ol>
              <li>Im Terminal ausführen: <code class="code" data-copy-cmd>claude mcp add --transport http bruno-board ${esc(location.origin)}/mcp</code></li>
              <li>In Claude Code <b>/mcp</b> eingeben, <b>bruno-board</b> wählen, anmelden und <b>Erlauben</b>.</li>
            </ol>
          </details>
          <details>
            <summary>Cursor, VS Code, Codex, Gemini CLI</summary>
            <p>Die Adresse oben als MCP-Server (HTTP) eintragen. Beim ersten Zugriff öffnet sich die Anmeldung, dann <b>Erlauben</b>.</p>
          </details>
          <p class="small muted">Die Gemini-App kann keine eigenen Connectoren außerhalb der USA. Hilfe gibt die Geschäftsführung.</p>
        </div>
        <div class="subs" style="margin-top:16px">
          <div class="subs-head"><h3>Verbunden</h3></div>
          <ul class="sub-list keys" data-conn-list><li class="none small muted">Lädt …</li></ul>
        </div>
      </section>
    </div>`;
  bindForm($('form', main), async (d) => {
    await savePassword(d);
    $('form', main).reset();
    toast('Passwort gespeichert. Andere Geräte wurden abgemeldet.');
  });
  $('[data-copy-url]', main).onclick = () => copy(`${location.origin}/mcp`);
  $('[data-copy-cmd]', main).onclick = (e) => copy(e.target.textContent);
  mountConnections($('[data-conn-list]', main), '/me');
}

route();
