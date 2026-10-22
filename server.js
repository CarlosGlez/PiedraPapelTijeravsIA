// Punto de entrada de AURA.
//  - Vercel detecta este archivo solo (server.js en la raíz, que usa express y exporta la app)
//    y lo convierte en una función. Los archivos de public/ los sirve Vercel directamente.
//  - En tu computadora, `npm start` además abre el puerto 3000.
import express from 'express';
import { crearApp } from './server/app.js';
import { crearDbDesdeEntorno } from './server/entorno.js';

const app = express();
app.use(crearApp(crearDbDesdeEntorno()));

export default app;

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🎮 AURA lista en http://localhost:${PORT}`);
  });
}
