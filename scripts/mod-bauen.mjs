// Baut die Mod „Bruno Live“ und legt sie unter public/downloads ab, wo sie das Profil zum Herunterladen anbietet.
//
//   npm run mod:bauen
//
// Braucht ein JDK 25 (JAVA_HOME). Für die Website selbst ist kein Java nötig: Die fertige Datei liegt im Repo.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mod = fileURLToPath(new URL('../mod/', import.meta.url));
const version = /^version=(.+)$/m.exec(readFileSync(`${mod}gradle.properties`, 'utf8'))[1].trim();
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
execSync(`"${mod}${gradlew}" --console=plain build`, { cwd: mod, stdio: 'inherit' });

const ziel = fileURLToPath(new URL('../public/downloads/', import.meta.url));
mkdirSync(ziel, { recursive: true });
copyFileSync(`${mod}build/libs/bruno-live-${version}.jar`, `${ziel}bruno-live.jar`);
console.log(`public/downloads/bruno-live.jar: Version ${version}, ${Math.round(statSync(`${ziel}bruno-live.jar`).size / 1024)} KB`);
