# 🎮 TikTok LIVE Games

**Siete juegos interactivos gratuitos para tu directo de TikTok.** Reaccionan en tiempo real a los regalos, los likes y el chat de tu LIVE. Descargá, configuralo en 5 minutos y transmití desde TikTok LIVE Studio u OBS.

> Creado por [@juanjoclassic](https://www.tiktok.com/@juanjoclassic) · Licencia **MIT** · 100% gratis

---

## 🕹️ Los juegos

| Ruta | Juego | Cómo se juega |
|---|---|---|
| `/titan` | ⚔️ **Guerra de Titanes** | Gift battle por equipos: el chat elige ROJO o AZUL y empuja la cuerda con regalos |
| `/arenagame` | 🥊 **Tap Tap Arena** | Combate PvP: avatares con HP, sierras, KO y muerte súbita. Regalos atacan, likes curan |
| `/arena` | 🌀 **Plinko de Avatares** | Tu avatar cae por la pirámide hasta el multiplicador x10 |
| `/overlay` | 🌍 **Batalla de Países** | Ranking por países y equipos con banderas |
| `/versus` | 🗳️ **Versus Político** | El chat vota con keywords y los regalos definen al ganador |
| `/bomba` | 💣 **La Bomba** | Patata caliente: pásala con regalos, taps o escribiendo PASA |
| `/carrera` | 🏁 **Carrera de Avatares** | Regalos impulsan tu avatar, los likes dan turbo, el primero en meta gana |

---

## ✅ Requisitos de tu PC

- **Windows 10/11, macOS o Linux**
- **Node.js 18 o superior** — [descargalo acá](https://nodejs.org) (elige la versión LTS)
- 4 GB de RAM recomendados
- Navegador actualizado (Chrome, Edge o Firefox)
- Para transmitir: **TikTok LIVE Studio** (gratis) u **OBS Studio**

---

## 🚀 Instalación (5 minutos)

### Paso 1 — Descargar el código

**Opción A — ZIP (más fácil):** descargá el ZIP desde el botón verde *"Code" → Download ZIP* y descomprimilo en la carpeta que quieras.

**Opción B — Git (para avanzados):**

```bash
git clone https://github.com/mylnzon58/tiktok-live-games.git
cd tiktok-live-games
```

### Paso 2 — Instalar Node.js

1. Andá a [nodejs.org](https://nodejs.org) y descargá la **versión LTS**.
2. Instalalo con las opciones por defecto.
3. Verificá que quedó bien abriendo una terminal:

```bash
node -v
npm -v
```

> Debe mostrar dos números de versión (ej. `v20.x.x` y `10.x.x`). Si no, reiniciá la terminal.

### Paso 3 — Instalar las dependencias

Abrí una terminal **dentro de la carpeta del proyecto** y ejecutá:

```bash
npm install
```

Esperá a que termine (descarga las librerías necesarias).

### Paso 4 — Configurar tu usuario de TikTok

1. En la carpeta del proyecto, abrí el archivo **`.env.example`** con un editor de texto (Bloc de notas, TextEdit, etc.).
2. **Renombralo a `.env`** (sin la parte `.example`).
3. Editá la primera línea y poné **tu usuario de TikTok** (el de tu perfil, sin `@`):

```env
TIKTOK_USERNAME=juanjoclassic
```

> Solo necesitás tu usuario público. **No** hace falta contraseña ni cookies.
> Las líneas de `TIKTOK_SESSION_ID` y `TIKTOK_TT_TARGET_IDC` se pueden dejar vacías.

### Paso 5 — Levantar el servidor

```bash
npm start
```

Verás mensajes del servidor. Abrí el navegador y entrá a:

```
http://localhost:3000
```

Si tu TikTok **no está en vivo**, el servidor espera y **reconecta solo** cuando arranques el directo. No hace falta reiniciar nada.

---

## 📺 Cómo transmitir

### Opción 1 — Browser Source (recomendada)

1. Arrancá tu directo en **TikTok LIVE Studio** (o OBS).
2. Agregá un **Browser Source / Navegador**.
3. Pegá la URL del juego que quieras, por ejemplo: `http://localhost:3000/bomba`
4. Ajustá el tamaño para que ocupe la pantalla. ¡Listo!

### Opción 2 — Compartir pantalla (la más simple)

1. En TikTok LIVE Studio, elegí **"Compartir pantalla"**.
2. Abrí el juego en tu navegador (`http://localhost:3000/bomba`).
3. Compartí esa ventana. Los espectadores ven el juego en vivo.

> Podés abrir varios juegos en pestañas o ventanas distintas y alternar entre ellos.

---

## 🔧 Solución de problemas

| Problema | Solución |
|---|---|
| `PORT` ocupado / error de puerto | Cerrá cualquier programa que use el puerto 3000, o cambiá el puerto con `PORT=3001 npm start` |
| "Esperando que el Live inicie..." | Normal: el servidor escucha hasta que estés EN VIVO. Empezá el directo y esperá unos segundos |
| El juego no reacciona | Verificá que el `TIKTOK_USERNAME` en `.env` sea tu usuario exacto (sin `@`, sin espacios) |
| El antivirus/firewall bloquea | Permití Node.js en el firewall (es un servidor local, no envía datos fuera de tu PC) |
| Error al instalar dependencias | Reinstalá Node.js con la versión LTS y ejecutá `npm install` de nuevo |
| ¿Reinicio la PC? | Para volver a usarlo: abrí la terminal en la carpeta y ejecutá `npm start` |

---

## ☕ Donaciones

Estos juegos son y serán **gratis para siempre**. Si te dieron regalos o noches memorables, devolvé el gesto con un cafecito:

- **Argentina:** alias Brubank `juanmonzon`
- **Internacional:** [buymeacoffee.com/digitaldevel](https://www.buymeacoffee.com/digitaldevel)

---

## ⚠️ Aviso importante

- Herramienta **no oficial**: no está afiliada a TikTok ni a ByteDance. Usala responsablemente y respetá los términos de TikTok.
- Solo **lee** datos públicos de tu LIVE (regalos, likes, chat). No envía mensajes ni toca tu cuenta.
- Los juegos **no incluyen mecánicas de apuestas ni premios** — cumplen con las políticas de contenido de TikTok para LIVE.

---

## 📄 Licencia

**MIT** — usalo, modificarlo y compartilo libremente. Ver [LICENSE](LICENSE).

Creado con mucho café por [@juanjoclassic](https://www.tiktok.com/@juanjoclassic).
