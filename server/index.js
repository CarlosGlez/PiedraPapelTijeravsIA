import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp } from './app.js';
import { crearDb } from './db.js';

// El .env se busca en la raíz del proyecto (junto a package.json),
// sin importar desde qué carpeta se ejecute el comando.
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Se acepta .env.local y .env. Si existen los dos, manda .env.local.
const ARCHIVOS_ENV = ['.env.local', '.env'].map((f) => path.join(RAIZ, f)).filter((f) => fs.existsSync(f));

for (const archivo of ARCHIVOS_ENV) {
  dotenv.config({ path: archivo, quiet: true });
  console.log(`📄 Leyendo ${archivo}`);
}
if (!ARCHIVOS_ENV.length) {
  const parecidos = fs.readdirSync(RAIZ).filter((f) => f.toLowerCase().startsWith('.env') || f.toLowerCase() === 'env');
  console.warn(`⚠️  No encontré .env ni .env.local en ${RAIZ}`);
  if (parecidos.length) {
    console.warn(`   Encontré: ${parecidos.join(', ')}. Renómbralo a ".env" (sin .txt ni .example).`);
  }
}

// Se aceptan varios nombres comunes para la llave
const leer = (...nombres) => {
  for (const n of nombres) {
    const valor = process.env[n]?.trim().replace(/^["']|["']$/g, '');
    if (valor) return { nombre: n, valor };
  }
  return null;
};
const url = leer('SUPABASE_URL');
const llave = leer('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY');
const PORT = process.env.PORT || 3000;

// Avisa si pusieron la llave pública en lugar de la secreta
function tipoDeLlave(valor) {
  if (valor.startsWith('sb_publishable_')) return 'publica';
  if (valor.startsWith('sb_secret_')) return 'secreta';
  try {
    const rol = JSON.parse(Buffer.from(valor.split('.')[1], 'base64url').toString()).role;
    return rol === 'service_role' ? 'secreta' : rol === 'anon' ? 'publica' : 'desconocida';
  } catch {
    return 'desconocida';
  }
}

let db = null;
if (!url || !llave) {
  console.warn('⚠️  El juego funcionará pero NO guardará nada. Falta en el .env:');
  if (!url) console.warn('   - SUPABASE_URL');
  if (!llave) console.warn('   - SUPABASE_SECRET_KEY');
} else {
  console.log(`🔑 Usando ${llave.nombre} (${llave.valor.slice(0, 12)}…) con ${url.valor}`);
  if (tipoDeLlave(llave.valor) === 'publica') {
    console.warn('⚠️  Esa es la llave PÚBLICA (anon/publishable). Necesitas la SECRET (sb_secret_...) o la service_role.');
  }
  db = crearDb({ url: url.valor, key: llave.valor });
}

crearApp(db).listen(PORT, () => {
  console.log(`🎮 AURA lista en http://localhost:${PORT}`);
});
