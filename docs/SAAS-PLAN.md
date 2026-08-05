# PLAN SAAS — TikTok LIVE Games Multitenant (Documento de planificación, no implementado)

> **Estado:** DOCUMENTACIÓN SOLO PARA FUTURO. No se construye todavía.
> **Creador:** @juanjoclassic — Repo interno privado: `mylnzon58/GameRankPaisTik`
> **Fecha de redacción:** 2026-08
> **Regla dura:** este documento NUNCA debe publicarse. Vive solo en el repo privado.
> Cuando el repo se haga público, la copia pública NO debe incluir este archivo ni `skills/` ni `AGENTS.md`.

---

## 1. Veredicto ejecutivo

El SaaS multitenant **es viable** con un stack de costo ~US$0-25/mes, pero:

- **Vercel queda descartado como host del conector/sockets** (límites técnicos duros, ver §3.1).
- **El onboarding es trivial**: los usuarios solo necesitan su `@usuario` de TikTok (el conector NO requiere credenciales, ver §3.2).
- **El riesgo real no es técnico**: es adquisición de usuarios, soporte y la dependencia de una librería no oficial (§3.5, §7).
- **Estrategia de entrada recomendada (embudo)**: gratis primero (repo público + landing) → venta de configuración/servicio → SaaS cuando haya demanda. NO construir el multitenancy antes de validar demanda.

## 2. Modelo de negocio

| Ítem | Valor |
|---|---|
| Trial gratuito | **3 días** desde el registro (una vez por email) |
| Plan mensual | **US$10/mes** (30 días, activación manual) |
| Código completo | **US$70** única vez (entrega de repo + guía + soporte inicial) |
| Servicio de configuración | **US$29** (levantar y dejar transmitiendo) |
| Pagos | Transferencia bancaria Argentina (CBU/alias) · **USDT BEP-20** · WhatsApp al cobrador |
| Super admins (por defecto) | `zeeroj@gmail.com` · `mylnzon58@gmail.com` |
| WhatsApp cobrador | `+54 9 3455 485718` (solo tras doble confirmación, no indexable) |

### 2.1 Flujo del usuario
1. Registro con Google OAuth o email+contraseña (Supabase Auth) → arranca trial de 3 días.
2. Panel: pega su `@usuario` de TikTok (único dato necesario) + guía visual de 1 pantalla.
3. Copia su URL fija por juego (`https://juegos.xyz/u/<slug>/bomba`) y la agrega como Browser Source en TikTok LIVE Studio / OBS, o comparte pantalla.
4. El servidor abre una conexión WebSocket a TikTok por tenant y emite eventos del juego solo a las salas del tenant.
5. Al vencer el trial: el socket se niega, el panel muestra "Trial terminado" y la pantalla de pagos.
6. Pagos: elige método → sube comprobante (comprimido en cliente) → admin aprueba → se activan 30 días.

### 2.2 Flujo P2P simulado (frontend)
- Botón de pago por WhatsApp → animación de carga por pasos ("Buscando cobrador P2P...") → aviso "Este cobrador" → botón de WhatsApp.
- El número NO existe en el HTML ni en el fuente legible: se ensambla en memoria tras doble confirmación (anti-indexación por regex-scrapers).
- Mensaje precargado: "Hola, quiero el servicio de configuración del juego por US$29".

## 3. Investigación y evidencias (2026)

### 3.1 Vercel NO puede correr el conector — fuentes
- Vercel anunció WebSocket nativo en beta pública el **22-jun-2026** (changelog oficial), pero: conexiones **máx. 5 minutos** por defecto (30 min solo en Pro, aún beta), **sin fan-out entre instancias, sin rooms, sin presencia**; la conexión queda pinneada a una función (kb oficial de Vercel; análisis de ably.com/vercel, jul-2026).
- Las funciones serverless mueren a los 10-60s (Hobby/Pro) — un directo de 3 horas = docenas de cortes por transmisión.
- **Hobby (gratis) prohíbe uso comercial** por sus términos ("personal, non-commercial projects"). Un SaaS pagado ahí viola ToS.
- Conclusión: Vercel solo sirve (opcionalmente) para el panel/landing en Pro (US$20/mes). El conector + Socket.IO viven en un servidor persistente.

### 3.2 tiktok-live-connector (librería del repo)
- Autor: **zerodytrash** (GitHub) — **NO es de TikFinity** (otra herramienta de overlays, también no oficial).
- Licencia: **MIT** → permite uso comercial sin restricciones.
- README oficial: *"No credentials are required"* — conecta al webcast público de cualquier streamer solo con su `@username`. Gifts, likes, chat, miembros, seguidores, shares, battles, preguntas.
- **Múltiples conexiones por proceso**: cada `WebcastPushConnection` es un WebSocket cliente liviano. Un proceso Node puede manejar decenas de conexiones simultáneas.
- `sessionId` es opcional y solo enriquece eventos. En el SaaS los usuarios NO lo necesitan → onboarding de 1 campo.
- Fallback comercial si la librería muere: **EulerStream API** (mismo ecosistema; tier free con 25 WebSockets en la nube; Business US$50/mes).

### 3.3 Supabase (externo, recomendado)
- Free: 500 MB DB, 1 GB storage, 5 GB egress, **50.000 MAU** (solo cuentan los que se autentican), Google OAuth + email incluidos, RLS, Realtime.
- **Trampa**: los proyectos free se pausan tras **7 días de inactividad** → mantener un cron de ping diario (o un keep-alive del conector).
- Pro: US$25/mes cuando escale.
- **¿Dentro del mismo servidor? NO.** Self-hosted agrega mantenimiento (Docker, upgrades, backups) sin beneficio en MVP. Externo managed = cero mantenimiento. Revisar solo si el límite de 50k MAU o los 200 realtime conns se acercan.

### 3.4 Hosting persistente gratis (para sockets + TikTok)
| Opción | Costo | Notas |
|---|---|---|
| **Oracle Cloud "Always Free"** (cloud.oracle.com) | **$0 para siempre** | ARM Ampere A1: hasta 4 OCPU / 24 GB RAM por cuenta. Pide tarjeta (no cobra) y aprobación. Puede dar "out of capacity" en algunas regiones → probar regiones (São Paulo, Frankfurt). Riesgo conocido: reclamación de VMs muy ociosas — mitigación: el proceso nunca está ocioso |
| Fly.io Hobby | $0 con cuotas | 3 VMs shared-cpu-1x 256MB incluidas; útil como plan B |
| Render free | $0 | ❌ Descartado: duerme a los 15 min de inactividad → mata la conexión TikTok |
| Hetzner CX22 | ~US$4.7/mes | Plan B pagado si Oracle falla (2 vCPU/4GB, buen precio) |
| Railway | ~US$5-10/mes | PaaS simple, git-push |

### 3.5 Políticas de TikTok (riesgo plataforma)
- API **no oficial**. TikTok 2025-H2: los streamers son responsables de todo lo que pase con herramientas de terceros en su LIVE; política "Regulated Goods and Services" (gambling) — **los juegos del repo ya fueron auditados y NO tienen mecánicas de casino/premio/apuesta** (ruleta, slots y subasta eliminados del código).
- Enforcement histórico: apunta a contenido en stream y spam/abuso de cuentas, no a overlays de lectura. Riesgo por cuenta: bajo pero no cero.
- El protocolo puede romperse sin aviso (mitigación: monitorear zerodytrash/TikTok-Live-Connector + fallback EulerStream).
- Mercado que valida: EulerStream vende estos datos como API comercial; Soulstudio vende overlays a US$14.99/mes.

## 4. Arquitectura objetivo

```
[Streamer] → TikTok LIVE Studio / OBS (Browser Source con URL fija del tenant)
                │ Socket.IO con token firmado (solo su tenant)
                ▼
   ┌─────────────────────────────────┐
   │ SERVIDOR PERSISTENTE (Oracle ARM│ ← ÚNICO lugar con tiktok-live-connector
   │  o Hetzner) — PM2               │   N conexiones TikTok (una por tenant activo)
   │ · Socket.IO rooms por tenant    │
   │ · Auth en handshake (JWT/ticket)│
   │ · Managers de juego por tenant  │
   └──────────┬──────────────────────┘
              │ validación de plan/trial
              ▼
   Supabase EXTERNO: auth (Google+email), users/tenants/subscriptions/payments,
   storage (comprobantes), RLS, rol admin (zeeroj@gmail.com, mylnzon58@gmail.com)
   Cloudflare Pages: panel + landing (gratis, uso comercial permitido)
```

- **Panel/landing**: Next.js + shadcn/ui en Cloudflare Pages (gratis, permite comercial — Vercel Hobby no).
- **Egreso por espectador**: ~1-2 KB/s de JSON de estado (sin video — el video lo distribuye TikTok). 1000 espectadores ≈ 1,5-2 MB/s ≈ 20 GB por directo de 3 h. Oracle free: 10 TB/mes → ~10-15 tenants transmitiendo a diario.

## 5. Capacidad (números honestos)

| Recurso | 1000 espectadores/tenant |
|---|---|
| RAM (Socket.IO) | ~30-60 MB (15-40 KB por socket) |
| CPU | Bajo (los juegos ya bachean emits 16-100 ms) |
| VM ARM 4GB | ~10-20 tenants × 1000 espectadores simultáneos |
| Cuello real | Banda (10 TB/mes) antes que RAM/CPU |

## 6. Refactor multitenant (cuando se construya)

| Hoy (single-tenant) | Multitenant |
|---|---|
| Managers singleton `require(...)(io)` | Factoría `new BombaManager(io, tenantId)` |
| `io.emit` global | Rooms por tenant + middleware de auth en handshake |
| `.env` único | Credenciales por usuario en Supabase, cargadas al conectar |
| URL `/bomba` | `https://juegos.xyz/u/<slug>/bomba` (fija por tenant) |
| Trial inexistente | `trial_ends_at` + rechazo en servidor de sockets + gate en panel |

Pasos:
1. Auth: Supabase JWT → handshake de socket con token firmado por tenant.
2. Aislamiento: cada manager instancia su estado por tenant; eventos a `io.to(room(tenant, juego))`.
3. Ciclo de vida: conectar TikTok cuando el tenant arranca LIVE; desconectar al terminar o al vencer plan.
4. Aprovisionamiento: cola de conexiones con reintentos (reutilizar patrón `connectToTikTok` del server.js actual).
5. Administración: tabla `subscriptions` (estado activo/vencido), panel admin.

## 7. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| TikTok rompe el protocolo | Alto (producto muerto) | Monitorear librería + fallback EulerStream + modo "desconectado" con debug simulado |
| ToS TikTok (API no oficial) | Medio | Solo lectura de datos públicos, sin credenciales; juegos sin mecánicas de azar; disclaimer |
| Soporte 24/7 de no técnicos | Alto (operación) | Onboarding de 1 campo + guías; FAQ; plantillas WhatsApp; plazas controladas |
| Supabase free se pausa | Bajo | Cron de ping diario |
| Oracle free "out of capacity" | Medio | Probar regiones; plan B Hetzner ~US$5/mes |
| Fraude en pagos manuales | Medio | Aprobación manual + comprobante requerido; un trial por email |
| Leak del código pago ($70) | Bajo | Inevitable con repos públicos; el valor es el servicio, no el código |

## 8. Fases (solo cuando haya demanda)

- **Fase 0 — Fundación**: Oracle ARM + dominio + Supabase (tablas, RLS, roles admin) + panel Next.js/shadcn con login y trial de 3 días.
- **Fase 1 — Multitenant**: refactor de managers, rooms, auth de handshake, URLs por tenant.
- **Fase 2 — Onboarding**: panel de credenciales (solo @), guía TikTok LIVE Studio, test con cuenta propia.
- **Fase 3 — Monetización**: pagos (transferencia/USDT/WhatsApp), comprobante comprimido (canvas ≤400 KB), panel admin de aprobación, flujo P2P simulado.
- **Fase 4 — Lanzamiento**: monitoreo del conector, keep-alive Supabase, diseño final, guías por rol del equipo.

## 9. Decisiones registradas (historial)

| Fecha | Decisión |
|---|---|
| 2026-08 | Juegos 100% gratis y públicos (MIT) — el SaaS se documenta para futuro |
| 2026-08 | Ruleta, slots y subasta eliminados por políticas TikTok (premio/apuesta/ruleta) |
| 2026-08 | Landing sin menciones de premio/casino/jackpot |
| 2026-08 | Repos separados: este (privado, con plan) + `mylnzon58/tiktok-live-games` (público, curado) |
| 2026-08 | Donaciones: alias Brubank `juanmonzon` + buymeacoffee.com/digitaldevel |
