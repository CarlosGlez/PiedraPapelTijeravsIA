// Lee la configuración (variables de entorno) y crea la conexión a Supabase.
//  - En tu computadora: las toma de .env.local o .env en la raíz del proyecto.
//  - En Vercel: las toma de Settings → Environment Variables (no hay archivo .env).
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearDb } from './db.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EN_VERCEL = Boolean(process.env.VERCEL);

function cargarArchivosEnv() {
  // Si existen los dos, manda .env.local
  const archivos = ['.env.local', '.env'].map((f) => path.join(RAIZ, f)).filter((f) => fs.existsSync(f));
  for (const archivo of archivos) {
    dotenv.config({ path: archivo, quiet: true });
    console.log(`📄 Leyendo ${archivo}`);
  }
  if (!archivos.length && !EN_VERCEL) {
    const parecidos = fs.readdirSync(RAIZ).filter((f) => f.toLowerCase().startsWith('.env') || f.toLowerCase() === 'env');
    console.warn(`⚠️  No encontré .env ni .env.local en ${RAIZ}`);
    if (parecidos.length) {
      console.warn(`   Encontré: ${parecidos.join(', ')}. Renómbralo a ".env" (sin .txt ni .example).`);
    }
  }
}

// Se aceptan varios nombres comunes para la llave
function leer(...nombres) {
  for (const n of nombres) {
    const valor = process.env[n]?.trim().replace(/^["']|["']$/g, '');
    if (valor) return { nombre: n, valor };
  }
  return null;
}

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

export function crearDbDesdeEntorno() {
  cargarArchivosEnv();
  const url = leer('SUPABASE_URL');
  const llave = leer('SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_KEY');

  if (!url || !llave) {
    const donde = EN_VERCEL ? 'en Vercel → Settings → Environment Variables (y vuelve a desplegar)' : 'en el .env';
    console.warn(`⚠️  El juego funcionará pero NO guardará nada. Falta ${donde}:`);
    if (!url) console.warn('   - SUPABASE_URL');
    if (!llave) console.warn('   - SUPABASE_SECRET_KEY');
    return null;
  }

  console.log(`🔑 Usando ${llave.nombre} (${llave.valor.slice(0, 12)}…) con ${url.valor}`);
  if (tipoDeLlave(llave.valor) === 'publica') {
    console.warn('⚠️  Esa es la llave PÚBLICA (anon/publishable). Necesitas la SECRET (sb_secret_...) o la service_role.');
  }
  return crearDb({ url: url.valor, key: llave.valor });
}
