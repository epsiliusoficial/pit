# Pit OS — Mapa de consolidación de features

Documento honesto, no un catálogo de marketing. Objetivo: que alguien técnico
que audite el proyecto vea **foco**, no una lista de 65 archivos sin
jerarquía. Clasificación en 4 niveles:

- 🟢 **NÚCLEO** — sin esto no hay producto de mensajería. Innegociable.
- 🔵 **DIFERENCIADOR REAL** — le gana a WhatsApp/Telegram en algo concreto,
  vale la pena mantenerlo visible.
- 🟡 **RUIDO** — anda, no está mal, pero no suma a la propuesta de valor y sí
  suma superficie de mantenimiento/ataque. Candidato a esconder detrás de un
  flag o directamente sacar del roadmap público.
- 🔴 **CONFLICTIVO / A REVISAR** — ya identificado en conflicto con E2E, en
  desuso, o directamente recomendado para eliminar.

---

## 🟢 Núcleo (17 archivos) — lo que TIENE que estar impecable

| Feature | Archivo | Estado |
|---|---|---|
| Mensajería en tiempo real | `chat/controller.ts` | ✅ E2E real, Double Ratchet |
| Autenticación (OTP, password) | `auth/controller.ts`, `otp.service.ts` | ✅ |
| 2FA | `auth/twoFactor.ts` | ✅ |
| Presencia (online/typing) | `chat/presence.ts` | ✅ |
| Reacciones | `chat/reactions.ts` | ✅ |
| Adjuntos/archivos | `files/controller.ts` | ✅ |
| Notificaciones push | `notifications/push.ts` | ✅ (genéricas tras E2E) |
| Llamadas 1:1 y grupales | `calls/signaling.ts`, `calls/groupCalls.ts` | ✅ |
| Rate limiting | `chat/rateLimiter.ts` | ✅ |
| Invitaciones a grupo | `chat/invites.ts` | ✅ |
| Multi-dispositivo | `auth/deviceLink.ts` | ✅ recién cerrado |
| Código de seguridad | `auth/safetyNumber.ts` | ✅ recién cerrado |

**Recomendación:** esto es lo que se pule primero si alguien va a auditar o
usar el producto en serio. Todo lo de abajo es secundario a que ESTO ande
perfecto.

---

## 🔵 Diferenciador real — vale la pena mantener visible

| Feature | Por qué es diferenciador real |
|---|---|
| **Panic PIN / modo coacción** (`auth/panicPin.ts`) | Ni WhatsApp ni Telegram lo tienen. Caso de uso real (coerción, fronteras). |
| **Chat Vault** (`auth/vault.ts`) | Separado del Panic PIN, resuelve un problema distinto (privacidad cotidiana vs coacción). |
| **Recuperación Social** (`auth/socialRecovery.ts`) | Consenso de guardianes al estilo wallet cripto — más seguro que "reset por email" de todos los demás. |
| **SOS de emergencia** (`auth/sos.ts`) | Caso de uso real y humano, no cosmético. |
| **Dead Man's Switch** (`auth/deadManSwitch.ts`) | Único en el mercado de chat mainstream. |
| **Reputación comunitaria de links** (`links/communityReports.ts`) | Mejora real sobre heurística sola. |
| **Multi-dispositivo + Código de seguridad** | Ya cubiertos arriba, pero son LOS que hacen creíble el "E2E real". |

**Recomendación:** estos son los que deberían aparecer en cualquier
landing/pitch — son los que un usuario técnico reconoce como reales, no como
relleno.

---

## 🟡 Ruido — mantenerlo, pero sacarlo de la vidriera

Todo esto "anda" (tiene tests, no está roto) pero es exactamente el tipo de
cosa que hace que un proyecto se vea disperso en vez de enfocado. No hace
falta borrarlo — alcanza con NO listarlo como feature destacada:

`social/achievements.ts`, `social/levels.ts`, `social/wrapped.ts`,
`games/chess.ts`, `chat/stickers.ts`, `chat/snooze.ts`, `chat/folders.ts`,
`chat/tasks.ts`, `chat/polls.ts`, `chat/sharedNote.ts`,
`chat/groupExpiration.ts`, `chat/joinRequests.ts`, `chat/customRoles.ts`,
`chat/announcements.ts`, `wallet/splitBill.ts`, `moderation/accountRisk.ts`,
`social/focus.ts`, `chat/screenshotAlert.ts`

**Recomendación concreta:** agrupar todo esto en un menú "Más funciones" en
vez de la lista plana actual. Ninguna de ellas debería aparecer en un pitch
de 30 segundos sobre qué es Pit OS.

---

## 🔴 Conflictivo / a revisar

| Feature | Problema |
|---|---|
| **Time Capsule** (`chat/timeCapsule.ts`) | Deshabilitada (410) — su mecánica central choca con E2E real. Sacar del código si no se va a rediseñar, no dejarla como ruta muerta. |
| **Búsqueda global/por chat server-side** | ✅ Resuelto: reemplazada por búsqueda real client-side (`searchMyMessages` en web-client), sobre el cache de mensajes que el dispositivo ya descifró. Límite real y declarado: no busca en historial que este dispositivo nunca cargó — precio honesto de que el server ya no puede indexar nada. |
| **Auto-Reply** (`chat/autoReply.ts`) | Sigue viva pero usa cifrado server-side viejo, NO el E2E nuevo — inconsistente con el resto del chat. Documentar esa asimetría o migrarla. |
| **Status/Historias** (`social/status.ts`) | Mismo caso: cifrado server-side, no E2E. Aceptable si se comunica así, no si se vende como "todo es E2E". |
| **Personal Reminders** (`auth/reminders.ts`) | Mismo caso — server-side, no E2E, y entrega mensajes en el chat compartido (revisar que el cliente no los muestre como "no se pudo descifrar"). |
| **Import** (`import/controller.ts`, `parser.ts`) | Sin auditar en esta sesión — qué tan seguro es parsear datos de otra plataforma merece revisión aparte. |
| **Verificación de cuenta** (`moderation/verification.ts`) + **Riesgo de cuenta** (`moderation/accountRisk.ts`) | Solapan conceptualmente — ver si conviene unificar en un solo módulo de "confianza de cuenta". |

---

## Recomendación de una sola línea

**No agregar ningún sistema nuevo hasta que la sección 🟢 esté probada con
carga real (loadtest/ ya armado) y auditada externamente.** Todo lo demás es
secundario a esos dos puntos si el objetivo real es "nivel de los grandes".
