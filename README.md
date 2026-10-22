# AURA · Piedra, Papel o Tijera

**AURA** es una IA contra la que juegas piedra, papel o tijera usando la cámara, y que se activa con la voz diciendo «Hey Aura». MediaPipe detecta tu mano, y la IA aprende tus patrones para ganarte. El historial y el marcador se guardan en Supabase a través de un backend en Node + Express.

## Cómo correrlo

1. **Crea un proyecto en [Supabase](https://supabase.com)**. El plan gratuito alcanza.
2. **Crea la base de datos:** en Supabase → *SQL Editor*, pega todo el contenido de `supabase/schema.sql` y dale *Run*.
3. **Configura las llaves:** copia `.env.example` como `.env` y llena:
   - `SUPABASE_URL`: en *Project Settings → API*.
   - `SUPABASE_SECRET_KEY`: la *secret key* (`sb_secret_...`) o la *service_role key*. Esta llave solo vive en el servidor: nunca la subas a GitHub ni la pongas en el frontend.
4. **Instala y arranca:**
   ```bash
   npm install
   npm start
   ```
5. Abre **http://localhost:3000** en Chrome y acepta el permiso de cámara.

Si el servidor arranca sin `.env`, el juego funciona igual en **modo local** (sin guardar nada). Así se puede probar la parte de la cámara antes de configurar Supabase.

## Qué tiene

| Función | Cómo funciona |
|---|---|
| **Detección de la mano** | MediaPipe da 21 puntos de la mano; se cuenta qué dedos están estirados (`public/js/gestos.js`). |
| **4 dificultades** | *Fácil*: tira al azar. *Normal*: aprende tus patrones. *Difícil*: combina tus patrones con los de todos los jugadores. *Imposible*: hace trampa, espera a ver tu mano. |
| **La IA te recuerda** | Al escribir tu nombre, la IA carga tus rondas anteriores desde Supabase y sigue aprendiendo de ti entre sesiones. |
| **IA colectiva** | En *Difícil* usa estadísticas de todos los jugadores: cómo abre la gente, qué saca después de cada tiro y qué hace después de ganar o perder. |
| **Modo torneo** | Mejor de 3 o mejor de 5. La base de datos cierra la partida al llegar a la meta. |
| **Detección de tiro tardío** | Ambos tiran en el «¡Ya!». Si cambias de gesto después de ver el tiro de la IA, el juego te cacha y cuenta tu primer tiro. |
| **«Hey Aura»** | El micrófono se activa solo al abrir la página. Con decir «Hey Aura» (o «Hey Aura, piedra, papel o tijera»), AURA arranca: en el menú empieza la partida y la primera ronda, en una partida juega otra ronda y en la pantalla final hace la revancha. Usa la Web Speech API (Chrome/Edge). |
| **Ranking** | Mejores porcentajes de victoria en Normal y Difícil (mínimo 10 rondas). |
| **Perfil del jugador** | Porcentaje de cada tiro y qué sueles sacar después de perder. |
| **Iconos** | [Font Awesome 6](https://fontawesome.com/search?o=r&m=free&s=solid) (gratis), cargado desde cdnjs. Los iconos de los tiros están en `public/js/iconos.js`. |
| **Efectos** | Sonidos generados con Web Audio, animaciones y confeti. |

## Cómo "piensa" la IA (`public/js/ia.js`)

La IA decide su tiro **antes** de ver tu mano; solo usa tu historial. Predice qué vas a sacar y elige lo que le gana.

- **Normal:** busca qué sacaste las veces anteriores en que tus últimas 2 jugadas fueron iguales a las de ahora (una cadena de Markov). Si no hay suficientes datos, prueba con la última jugada y luego con tu tiro más frecuente. Tira al azar un 10% de las veces para no ser predecible.
- **Difícil:** junta varias "pistas" (tus patrones, lo que haces después de ganar o perder, tu tiro favorito y los datos de todos los jugadores). Cada pista vota con un peso, y las que tienen poca evidencia pesan menos.

En pantalla se ve en qué se basó cada predicción y cuántas acertó.

## Estructura

```
server/
  index.js        arranque: lee .env y levanta el servidor
  app.js          rutas de la API, validación y manejo de errores
  db.js           todas las consultas a Supabase
supabase/
  schema.sql      tablas, funciones, ranking y seguridad (RLS)
public/
  index.html, styles.css
  js/main.js      flujo del juego, cámara y pantalla
  js/gestos.js    clasificación piedra/papel/tijera
  js/ia.js        predicción y decisión de la IA
  js/api.js       cliente de la API (con reintentos y modo local)
  js/efectos.js   sonidos y confeti
  js/voz.js       comando de voz «Hey Aura»
  js/iconos.js    iconos de Font Awesome
```

## API

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/api/salud` | Saber si el servidor y Supabase responden |
| POST | `/api/jugadores` | `{ nombre }`: registra o recupera un jugador |
| GET | `/api/jugadores/:id/historial` | Rondas anteriores del jugador (para la IA) |
| POST | `/api/partidas` | `{ jugador_id, dificultad, modo }`: inicia una partida |
| POST | `/api/partidas/:id/rondas` | `{ numero, tiro_jugador, tiro_ia, prediccion, tiro_tardio }`: guarda una ronda |
| POST | `/api/partidas/:id/terminar` | Cierra una partida |
| GET | `/api/ranking` | Top 10 |
| GET | `/api/estadisticas/globales` | Datos de todos los jugadores (modo difícil) |

### Decisiones de diseño del backend
- **El resultado lo calcula la base de datos**, no el cliente: así nadie puede mandar «gané» desde la consola del navegador.
- **Registrar una ronda es idempotente:** `(partida_id, numero)` es único. Si la conexión falla y el cliente reintenta, la ronda no se cuenta dos veces.
- **Ronda y marcador se actualizan en una sola transacción** (función `registrar_ronda`), con la partida bloqueada para que dos peticiones no pisen el marcador.
- **Seguridad:** RLS activado y permisos revocados para `anon` y `authenticated`. Solo el backend, con la secret key, puede leer y escribir.

## Problemas comunes
- **No detecta bien la tijera:** muestra la palma o el dorso a la cámara, no la mano de perfil. Si confunde gestos, sube `UMBRAL` a `1.2` en `public/js/gestos.js`.
- **«Llegaste tarde»:** el tiro se lee entre 0.1 y 0.5 s después del «¡Ya!». Saca la mano justo en ese momento.
- **La voz no funciona:** solo en Chrome o Edge, con internet y permiso de micrófono. Debajo del título aparece lo último que escuchó el micrófono, para que veas si te está entendiendo. Acepta variantes como «ey aura», «oye aura» o «hey laura», porque así lo transcribe a veces.
- **La voz se activa sola y no quiero:** apágala con el botón del micrófono; la página lo recuerda.
- **Poca luz:** la detección falla más; busca buena iluminación de frente.
