// Dachfläche: eine einzige Lage auf y = 36, innerhalb der Attika. Keine Technik obendrauf.
// Helle Bahnen mit feinen Stößen, Laufwege aus Platten, Oberlichter über den Hauptgängen.
// Leuchten sitzen bündig in der Fläche, damit nachts keine Monster auf dem Dach spawnen (siehe gen-rechenzentrum.mjs).
import { BAU, box, set, stoff } from './raster.mjs';

const d = stoff('dach');
const S = {
  dach: d('Dachfläche', 'smooth_stone'),
  fuge: d('Dachfuge', 'polished_andesite'),
  platte: d('Laufweg', 'gray_concrete'),
  oberlicht: d('Oberlicht', 'glass'),
};
export const DACHLEUCHTE = d('Dachleuchte', 'sea_lantern');

export const DACHPLATTE = 36;
export const DACH = { x0: 3, x1: BAU.x - 4, z0: 3, z1: BAU.z - 4 };

function flaeche() {
  for (let z = DACH.z0; z <= DACH.z1; z++) for (let x = DACH.x0; x <= DACH.x1; x++) {
    set(x, DACHPLATTE, z, x % 12 === 0 || z % 12 === 0 ? S.fuge : S.dach);
  }
}

// Laufwege längs und quer, bündig in der Fläche
function wege() {
  for (let z = DACH.z0; z <= DACH.z1; z++) {
    for (const x0 of [3, BAU.x - 6, 42, 75]) for (let x = x0; x <= x0 + 2; x++) set(x, DACHPLATTE, z, S.platte);
  }
  for (let x = DACH.x0; x <= DACH.x1; x++) for (const z0 of [52, 94, 107, 150]) {
    for (let z = z0; z <= z0 + 1; z++) set(x, DACHPLATTE, z, S.platte);
  }
}

function oberlichter() {
  for (let z = 56; z <= 90; z += 8) box(38, DACHPLATTE, z, 41, DACHPLATTE, z + 1, S.oberlicht);
}

export function dachBauen() {
  flaeche();
  wege();
  oberlichter();
}
