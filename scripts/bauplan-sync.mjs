// Gleicht den Bauplan mit einer Minecraft-Welt ab und meldet den Baufortschritt an das Intranet.
//
//   npm run bauplan:sync -- <Weltordner oder world.zip> --nur-pruefen
//   BAUPLAN_SYNC_KEY=... npm run bauplan:sync -- <Weltordner oder world.zip> --url https://...
//
// Gelesen werden nur die Region-Dateien der Oberwelt, verglichen wird nur die Block-ID.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { join } from 'node:path';

const plan = JSON.parse(readFileSync(new URL('../public/rechenzentrum.plan.json', import.meta.url), 'utf8'));

function argumente() {
  const a = process.argv.slice(2);
  const wert = (name) => {
    const i = a.indexOf(name);
    if (i < 0) return undefined;
    const [v] = a.splice(i, 2).slice(1);
    return v;
  };
  const url = wert('--url');
  const ankerText = wert('--anker');
  const i = a.indexOf('--nur-pruefen');
  const nurPruefen = i >= 0;
  if (nurPruefen) a.splice(i, 1);
  return { pfad: a[0], url, ankerText, nurPruefen };
}

// ---------- Welt lesen: Ordner oder Zip ----------

const REGION_ORDNER = ['dimensions/minecraft/overworld/region', 'region'];

function ordnerQuelle(welt) {
  const ordner = REGION_ORDNER.map((o) => join(welt, o)).find((o) => existsSync(o));
  if (!ordner) throw new Error(`Keine Region-Dateien in ${welt}. Erwartet: ${REGION_ORDNER.join(' oder ')}`);
  return (name) => {
    const datei = join(ordner, name);
    return existsSync(datei) ? readFileSync(datei) : null;
  };
}

function zipQuelle(datei) {
  const zip = readFileSync(datei);
  let ende = zip.length - 22;
  while (ende >= 0 && zip.readUInt32LE(ende) !== 0x06054b50) ende--;
  if (ende < 0) throw new Error(`${datei} ist kein gültiges Zip-Archiv.`);
  const anzahl = zip.readUInt16LE(ende + 10);
  let p = zip.readUInt32LE(ende + 16);
  if (anzahl === 0xffff || p === 0xffffffff) throw new Error(`${datei} ist zu groß für das Zip-Lesen. Bitte entpacken und den Ordner angeben.`);
  const eintraege = new Map();
  for (let i = 0; i < anzahl; i++) {
    const verfahren = zip.readUInt16LE(p + 10);
    const groesse = zip.readUInt32LE(p + 20);
    const nameLaenge = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const kommentar = zip.readUInt16LE(p + 32);
    const kopf = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLaenge).replaceAll('\\', '/');
    const treffer = REGION_ORDNER.find((o) => name === `${o}/${name.split('/').pop()}` || name.endsWith(`/${o}/${name.split('/').pop()}`));
    // "region/" kommt auch in Nether und End vor, die gehören nicht dazu.
    if (treffer && !/\/(DIM-?1|the_nether|the_end)\//.test(`/${name}`)) {
      eintraege.set(name.split('/').pop(), { verfahren, groesse, kopf });
    }
    p += 46 + nameLaenge + extra + kommentar;
  }
  if (eintraege.size === 0) throw new Error(`Keine Region-Dateien der Oberwelt in ${datei}.`);
  return (name) => {
    const e = eintraege.get(name);
    if (!e) return null;
    const start = e.kopf + 30 + zip.readUInt16LE(e.kopf + 26) + zip.readUInt16LE(e.kopf + 28);
    const roh = zip.subarray(start, start + e.groesse);
    return e.verfahren === 8 ? inflateRawSync(roh) : roh;
  };
}

// ---------- Region- und Chunk-Format ----------

function nbtLesen(buf) {
  let p = 0;
  const text = () => {
    const n = buf.readUInt16BE(p);
    p += 2;
    const s = buf.toString('utf8', p, p + n);
    p += n;
    return s;
  };
  const wert = (typ) => {
    switch (typ) {
      case 1: return buf.readInt8(p++);
      case 2: p += 2; return buf.readInt16BE(p - 2);
      case 3: p += 4; return buf.readInt32BE(p - 4);
      case 4: p += 8; return 0; // Long wird hier nie gebraucht
      case 5: p += 4; return 0;
      case 6: p += 8; return 0;
      case 7: { const n = buf.readInt32BE(p); p += 4 + n; return null; }
      case 8: return text();
      case 9: {
        const t = buf.readInt8(p++);
        const n = buf.readInt32BE(p);
        p += 4;
        const liste = [];
        for (let i = 0; i < n; i++) liste.push(wert(t));
        return liste;
      }
      case 10: {
        const o = {};
        for (;;) {
          const t = buf.readInt8(p++);
          if (t === 0) return o;
          const name = text();
          o[name] = wert(t);
        }
      }
      case 11: { const n = buf.readInt32BE(p); p += 4 + n * 4; return null; }
      case 12: { const n = buf.readInt32BE(p); p += 4; const start = p; p += n * 8; return { start, n }; }
      default: throw new Error(`Unbekannter NBT-Typ ${typ}`);
    }
  };
  const t = buf.readInt8(p++);
  text();
  return { daten: wert(t), buf };
}

function chunkLesen(region, cx, cz, quelle) {
  const kopf = 4 * ((cx & 31) + (cz & 31) * 32);
  const sektor = region.readUIntBE(kopf, 3);
  if (sektor === 0) return null;
  const start = sektor * 4096;
  const laenge = region.readUInt32BE(start);
  const art = region[start + 4];
  // Sehr große Chunks liegen in einer eigenen .mcc-Datei
  const roh = art & 0x80 ? quelle(`c.${cx}.${cz}.mcc`) : region.subarray(start + 5, start + 4 + laenge);
  if (!roh) return null;
  switch (art & 0x7f) {
    case 1: return nbtLesen(gunzipSync(roh));
    case 2: return nbtLesen(inflateSync(roh));
    case 3: return nbtLesen(roh);
    default: throw new Error(`Chunk-Kompression ${art & 0x7f} wird nicht unterstützt. In server.properties region-file-compression=deflate setzen.`);
  }
}

// Paletteneintrag zu Block-ID. Seit 26.x sind Blöcke ohne Eigenschaften blanke Texte, in gemischten
// Listen stecken sie in einer Hülle mit leerem Schlüssel. Ältere Welten haben immer { Name, Properties }.
function paletteId(eintrag) {
  const text = typeof eintrag === 'string' ? eintrag : eintrag.Name ?? eintrag[''];
  return text.split('[')[0];
}

// Block an Chunk-Position (x, z je 0–15, y = Welthöhe). Fehlt die Sektion, ist dort Luft.
function blockIn(sektionen, buf, lx, wy, lz) {
  const s = sektionen.get(wy >> 4);
  const zustaende = s?.block_states;
  if (!zustaende) return 'minecraft:air';
  const palette = zustaende.palette;
  if (!zustaende.data) return paletteId(palette[0]);
  const bits = Math.max(4, Math.ceil(Math.log2(palette.length)));
  const proLong = Math.floor(64 / bits);
  const i = ((wy & 15) << 8) | (lz << 4) | lx;
  const long = buf.readBigUInt64BE(zustaende.data.start + 8 * Math.floor(i / proLong));
  const index = (long >> BigInt((i % proLong) * bits)) & ((1n << BigInt(bits)) - 1n);
  return paletteId(palette[Number(index)]);
}

// ---------- Abgleich ----------

function planBloecke() {
  const { x: GX, z: GZ } = plan.groesse;
  const g = plan.gebaeude;
  const bloecke = [];
  plan.layers.forEach((schicht, y) => {
    let i = 0;
    for (const [, n, c] of schicht.matchAll(/(\d+)(\D)/g)) {
      const anzahl = Number(n);
      if (c !== '.') {
        for (let k = 0; k < anzahl; k++) {
          const q = i + k;
          bloecke.push({ dx: q % GX - g.x, dy: y - g.y, dz: Math.floor(q / GX) % GZ - g.z, c });
        }
      }
      i += anzahl;
    }
  });
  return bloecke;
}

function abgleichen(quelle, anker) {
  const bloecke = planBloecke();
  // Falsch ist nur ein Baustoff des Plans am falschen Platz, nicht das Gelände darunter.
  const NATUR = /^minecraft:(stone|andesite|tuff|deepslate|gravel|sand|grass_block|moss_block|podzol|coarse_dirt|dirt|water|lava|short_grass|fern|poppy|oxeye_daisy|dandelion|cornflower|allium|oak_log|oak_leaves|birch_log|birch_leaves|spruce_log|spruce_leaves|dark_oak_log|dark_oak_leaves|azalea_leaves|flowering_azalea_leaves|sugar_cane|lily_pad|bamboo)$/;
  const baustoffe = new Set(Object.values(plan.palette).map((p) => p.block).filter((b) => !NATUR.test(b)));
  const proChunk = new Map();
  bloecke.forEach((b, nummer) => {
    const wx = anker.x + b.dx;
    const wz = anker.z + b.dz;
    const schluessel = `${wx >> 4},${wz >> 4}`;
    if (!proChunk.has(schluessel)) proChunk.set(schluessel, []);
    proChunk.get(schluessel).push({ nummer, wx, wy: anker.y + b.dy, wz, soll: plan.palette[b.c].block, abschnitt: plan.palette[b.c].abschnitt });
  });

  const bits = Buffer.alloc(Math.ceil(bloecke.length / 8));
  const falsch = {};
  const zaehler = {};
  let gebautAnzahl = 0;
  let fehlendeChunks = 0;
  const regionen = new Map();
  for (const [schluessel, liste] of proChunk) {
    const [cx, cz] = schluessel.split(',').map(Number);
    const name = `r.${cx >> 5}.${cz >> 5}.mca`;
    if (!regionen.has(name)) regionen.set(name, quelle(name));
    const region = regionen.get(name);
    const chunk = region && chunkLesen(region, cx, cz, quelle);
    if (!chunk) fehlendeChunks++;
    const sektionen = new Map((chunk?.daten.sections ?? []).map((s) => [s.Y, s]));
    for (const b of liste) {
      const z = (zaehler[b.abschnitt] ??= { gesamt: 0, gebaut: 0 });
      z.gesamt++;
      if (!chunk) continue;
      // Betonpulver zählt als Beton derselben Farbe (wird oft als Pulver gesetzt und erst später gehärtet).
      const roh = blockIn(sektionen, chunk.buf, b.wx & 15, b.wy, b.wz & 15);
      const ist = roh?.endsWith('_concrete_powder') ? roh.slice(0, -'_powder'.length) : roh;
      if (ist === b.soll) {
        bits[b.nummer >> 3] |= 1 << (b.nummer & 7);
        gebautAnzahl++;
        z.gebaut++;
      } else if (baustoffe.has(ist)) {
        (falsch[ist] ??= []).push(b.nummer);
      }
    }
  }
  return { gesamt: bloecke.length, gebaut: bits.toString('base64'), gebautAnzahl, falsch, zaehler, fehlendeChunks, chunks: proChunk.size };
}

// ---------- Ablauf ----------

async function main() {
  const { pfad, url, ankerText, nurPruefen } = argumente();
  if (!pfad) throw new Error('Aufruf: npm run bauplan:sync -- <Weltordner oder world.zip> [--anker x,y,z] [--url https://...] [--nur-pruefen]');
  const teile = ankerText?.split(',').map(Number);
  const anker = teile ? { x: teile[0], y: teile[1], z: teile[2] } : plan.anker;
  if (!anker || [anker.x, anker.y, anker.z].some((n) => !Number.isInteger(n))) {
    throw new Error('Kein Standort. Mit --anker x,y,z die Nordwest-Ecke des Gebäudes (unterste Ebene) angeben oder ANKER im Plan setzen.');
  }

  const quelle = statSync(pfad).isDirectory() ? ordnerQuelle(pfad) : zipQuelle(pfad);
  const e = abgleichen(quelle, anker);

  const prozent = (z) => ((100 * z.gebaut) / z.gesamt).toFixed(2);
  for (const [abschnitt, z] of Object.entries(e.zaehler)) console.log(`${abschnitt}: ${z.gebaut} von ${z.gesamt} Blöcken (${prozent(z)} %)`);
  console.log(`Falsche Blöcke: ${Object.values(e.falsch).reduce((s, l) => s + l.length, 0)}`);
  if (e.fehlendeChunks) console.log(`Hinweis: ${e.fehlendeChunks} von ${e.chunks} Chunks sind noch nicht erzeugt und zählen als offen.`);
  if (nurPruefen) return;

  const ziel = url ?? process.env.BAUPLAN_SYNC_URL;
  const schluessel = process.env.BAUPLAN_SYNC_KEY;
  if (!ziel || !schluessel) throw new Error('Zum Melden braucht es --url (oder BAUPLAN_SYNC_URL) und BAUPLAN_SYNC_KEY. Nur ansehen: --nur-pruefen.');
  const antwort = await fetch(new URL('/api/bauplan/fortschritt', ziel), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${schluessel}` },
    body: JSON.stringify({ plan_hash: plan.hash, gebaut: e.gebaut, gebaut_anzahl: e.gebautAnzahl, falsch: e.falsch }),
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(`Das Intranet lehnt ab (${antwort.status}): ${daten.error ?? 'unbekannt'}`);
  console.log('Fortschritt gemeldet.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
