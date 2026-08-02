# Pit OS — Diseño de cifrado (para auditoría externa)

Este documento existe para una sola razón: que cuando alguien externo audite
esto, no tenga que reconstruir el diseño leyendo comentarios sueltos en 6
archivos. Es descriptivo, no promocional — incluye los límites tanto como
las garantías.

## Qué protege esto (garantías reales)

1. **Confidencialidad E2E de mensajes de chat**: el contenido de un mensaje
   se cifra en el dispositivo del remitente y solo se puede abrir en los
   dispositivos de los destinatarios reales. El servidor almacena y
   retransmite un sobre opaco — verificado en esta sesión que ningún
   endpoint del servidor puede leer el contenido (ver `chat/controller.ts`,
   función `/send` y las lecturas de historial/hilos/exportación).
2. **Forward secrecy** (secreto hacia adelante): filtrar la clave privada
   de identidad hoy no permite descifrar mensajes de conversaciones
   pasadas, porque cada mensaje usa una clave derivada que se destruye
   después de un solo uso.
3. **Post-compromise security** (secreto después de un compromiso): si la
   clave privada de identidad se filtra, la conversación se vuelve a
   proteger sola en cuanto la otra parte manda una respuesta más — esa
   respuesta ratchea con una clave efímera que el atacante nunca tuvo.
4. **Multi-dispositivo sin exponer la clave**: vincular un dispositivo
   nuevo transfiere la clave privada real cifrada por ECDH efímero — el
   servidor solo relaya un blob que no puede abrir, de un solo uso, TTL de
   5 minutos.
5. **Detección de MITM/compromiso de cuenta**: código de seguridad
   determinístico entre dos claves públicas, con alerta explícita si la
   clave pública de un contacto cambió desde la última verificación.

## Protocolo, en corto

- **Bootstrap de sesión**: X3DH simplificado — raíz inicial = hash(ECDH
  estático entre ambas identidades). No hay pre-keys ni one-time keys
  estilo Signal completo; el bootstrap asume que ambas partes ya se
  conocen la clave pública de identidad (vía el endpoint
  `GET /:chatId/members`, que expone únicamente claves públicas).
- **Double Ratchet real**: cadena simétrica (KDF con SHA-512, ver
  `kdf()`/`kdfRootAndChain()` en `web-client/index.html`) + ratchet DH
  cruzado (cada parte genera un par de claves efímero al pasar de
  "recibir" a "responder", combinado por ECDH con la última pública
  recibida del otro lado). La clave de ratchet propia se RETIENE hasta el
  próximo ratchet, no se borra al toque — es el punto que se verificó con
  una prueba de round-trip antes de integrarlo (encontró y corrigió un bug
  real de diseño).
- **Envoltura por destinatario**: cada mensaje usa una clave de contenido
  random (`nacl.secretbox`), envuelta una vez por cada destinatario con su
  clave de mensaje del ratchet — evita cifrar el contenido N veces en un
  grupo de N personas.
- **KDF usado**: HKDF-SHA256 real (RFC 5869) vía WebCrypto (`crypto.subtle`) —
  Extract-then-Expand completo para la derivación de raíz+cadena a partir
  del DH (que no es uniformemente random), y HMAC-SHA256 directo para el
  avance de la cadena simétrica (mismo criterio que usa Signal: no hace
  falta el paso de Extract cuando el material ya es indistinguible de
  random). Reemplaza la versión anterior (SHA-512 con etiquetas
  concatenadas a mano) — validado con una prueba de round-trip completa
  antes de integrarlo (determinismo del HKDF, separación de dominio por
  `info`, y el ratchet cruzado completo dando la misma clave en ambos
  lados en cada paso).
- **Lookahead de mensajes fuera de orden**: hasta 200 pasos de ratchet
  (`MAX_RATCHET_LOOKAHEAD`) — más que eso se descarta el mensaje.

## Qué NO protege (límites reales, no ocultos)

- **Sin verificación automática de identidad**: el código de seguridad
  existe pero depende de que el usuario lo compare activamente por otro
  canal. Nadie lo hace por default — mismo problema de adopción que tiene
  Signal en el mundo real.
- **Sin backup de claves**: si se borra el `localStorage` de un dispositivo
  sin vincular otro antes, la clave privada real y todo el historial
  E2E se pierden para siempre. No hay recuperación posible ni por
  Recuperación Social (esa es para la cuenta/password, no para las claves
  E2E).
- **Metadata visible para el servidor**: quién le habla a quién, cuándo,
  con qué frecuencia — el servidor sigue viendo todo esto (como
  prácticamente cualquier app de mensajería, incluida Signal). El cifrado
  E2E protege el contenido, no el grafo social.
- **Contenido NO-E2E declarado**: Auto-Respuesta (`chat/autoReply.ts`),
  Estados/Historias (`social/status.ts`) y Recordatorios Personales
  (`auth/reminders.ts`) siguen cifrados con la clave del servidor, no con
  el sobre E2E — documentado en el propio código de cada uno.
- **Sin auditoría de terceros**: todo lo de este documento fue diseñado e
  implementado en esta sesión, con pruebas propias (unitarias +
  standalone), pero NINGUNA parte pasó por un criptógrafo externo. Eso es
  la diferencia real entre esto y Signal, no el diseño en sí.
- **KDF no estandarizado**: como se dice arriba, SHA-512 con etiquetas en
  vez de HKDF formal. Funciona, pero un auditor probablemente pida
  migrarlo a HKDF-SHA256 de la RFC 5869 antes de dar el visto bueno.
- **Sin protección contra servidor malicioso activo**: el modelo asume un
  servidor "honesto pero curioso" (no puede leer contenido, pero no se
  audita qué pasaría si el servidor activamente miente sobre qué clave
  pública tiene un usuario — un ataque de sustitución de clave en el
  primer contacto no está mitigado más que por la verificación manual del
  código de seguridad).

## Qué probar antes de confiar esto con datos reales

1. Auditoría criptográfica externa real (no este documento, no las pruebas
   de esta sesión).
2. Pen-testing del endpoint `/api/devicelink/*` específicamente — es la
   superficie nueva más sensible (transferencia de clave privada).

## Bug real confirmado: mensajería rota entre tus propios dispositivos

Esto se encontró con una simulación real (no es una sospecha teórica): si
vinculás dos dispositivos (celu + compu) y mandás mensajes desde los dos
casi al mismo tiempo hacia la misma persona, **el segundo mensaje puede
llegar sin que el receptor lo pueda abrir**.

**Por qué pasa:** cada dispositivo tuyo tiene su propio `localStorage`, sin
sincronizar entre sí. Los dos comparten la misma clave de identidad (gracias
a la vinculación de dispositivo), pero cada uno mantiene su PROPIA sesión de
ratchet hacia cada contacto — con su propia raíz, que solo avanza cuando ESE
dispositivo puntual recibe algo nuevo. Si tu celu manda un mensaje y el
receptor ratchea su raíz en respuesta a eso, y después tu compu manda otro
mensaje usando la raíz vieja (porque nunca se enteró del ratchet que pasó
del lado del celu), las raíces quedan desincronizadas — no es un problema de
"orden de llegada", es que las dos partes ya no van a derivar la misma
clave para nada más en esa conversación.

**Por qué no es un parche rápido:** la solución real (la que usa Signal) es
que cada sesión de Double Ratchet sea por PAR DE DISPOSITIVOS, no por par de
usuarios — cada uno de tus dispositivos necesitaría su propia identidad
criptográfica, y quien te escribe tendría que mandar una copia del mensaje
cifrada para cada uno de tus dispositivos por separado (fan-out). Eso es un
cambio de arquitectura real: tocar el modelo de sesión, el fan-out de
mensajes, y probablemente el propio modelo de "vincular dispositivo" (que
hoy transfiere UNA identidad compartida, en vez de crear una identidad
propia por dispositivo). No es algo para resolver con un ajuste de una
tarde — queda documentado acá como el hallazgo más serio de esta sesión de
consolidación, para que quien audite esto lo vea de entrada.

**Mitigación mínima hasta que se rediseñe:** si solo usás UN dispositivo
activo a la vez para una conversación dada (no mandás desde el celu y la
compu en la misma ventana de tiempo sin que el otro se entere), el problema
no se manifiesta — el ratchet cruzado anda perfecto en el caso de un solo
dispositivo activo por conversación, que es el caso que se verificó en esta
sesión. El bug es específicamente sobre USO CONCURRENTE de dos dispositivos
en la misma conversación.

**Nota final importante:** el modo de falla es seguro, no catastrófico — el
mensaje que no se puede abrir se muestra como "🔒 No se pudo descifrar este
mensaje en este dispositivo" (ya estaba manejado así desde la fase de E2E),
no como un crash ni como contenido corrupto o falso. Es un problema real de
usabilidad/confiabilidad, no un agujero de seguridad — nadie ve el mensaje
de otro por error, simplemente uno propio no siempre llega.
