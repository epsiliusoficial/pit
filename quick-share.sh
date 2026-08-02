#!/bin/bash
# Sistema "Publicar en 1 comando, sin dominio ni VPS": levanta Pit local
# (docker-compose.yml, el de desarrollo) y lo expone a internet con HTTPS
# real usando un túnel gratuito de Cloudflare (cloudflared). Pensado para
# "quiero que mi amigo lo pruebe YA" sin comprar dominio, sin VPS, sin
# certbot. El deploy.sh de producción (con dominio propio) sigue siendo el
# camino correcto para algo permanente — esto es para probar/demoar HOY.
#
# Uso:
#   chmod +x quick-share.sh
#   ./quick-share.sh
#
# Qué hace, sin humo:
# 1. Levanta postgres + redis + backend con docker-compose.yml (el de
#    desarrollo, NODE_ENV=development — no genera secretos de producción
#    porque esto NO es para dejarlo corriendo semanas, es para una demo).
# 2. Instala `cloudflared` si no está (binario oficial de Cloudflare).
# 3. Abre un "quick tunnel": una URL pública *.trycloudflare.com con HTTPS
#    válido de verdad, que reenvía a tu backend local. Cloudflare la genera
#    gratis y sin cuenta — dura mientras el proceso quede corriendo.
# 4. Imprime la URL para que se la mandes a quien quieras que pruebe Pit.
#
# Limitación honesta: es un túnel efímero (si cerrás la terminal, se cae la
# URL y hay que correr esto de nuevo, y te da una URL nueva cada vez — para
# algo permanente con tu propia URL fija, usá deploy.sh + un dominio real).
set -e

echo "🚀 Levantando Pit en modo local..."
docker compose up -d

echo "⏳ Esperando a que el backend responda en :3000..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -sf http://localhost:3000/health > /dev/null 2>&1; then
  echo "⚠️  El backend no respondió a tiempo. Revisá 'docker compose logs backend'."
  exit 1
fi
echo "✅ Backend arriba en local."

if ! command -v cloudflared &> /dev/null; then
  echo "📦 Instalando cloudflared..."
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then
    CF_ARCH="amd64"
  elif [ "$ARCH" = "aarch64" ]; then
    CF_ARCH="arm64"
  else
    echo "⚠️  Arquitectura $ARCH no reconocida automáticamente. Instalá cloudflared a mano:"
    echo "    https://github.com/cloudflare/cloudflared/releases"
    exit 1
  fi
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"
  sudo dpkg -i /tmp/cloudflared.deb
fi

echo ""
echo "🌐 Abriendo túnel público (esto queda corriendo — no cierres esta terminal)..."
echo "   La URL pública va a aparecer abajo, algo como https://algo-random.trycloudflare.com"
echo ""

# Sistema "Publicar aún más fácil" (mejora real, no solo cosmética): antes
# había que copiar la URL del log de cloudflared a mano y mandarla vos mismo
# a quien fuera a probar Pit. Ahora, apenas cloudflared imprime la URL real:
# 1. Se guarda en un archivo (.last-share-url) para poder recuperarla después
#    con "cat .last-share-url" si cerrás la terminal sin querer y volvés.
# 2. Si hay `qrencode` instalado, se imprime un QR ASCII en la terminal —
#    quien va a probar Pit desde el celular escanea y entra directo, sin
#    tipear ninguna URL larga a mano.
# 3. Si NO hay `qrencode`, se instala solo (paquete estándar de apt, liviano)
#    para que esto funcione la primera vez sin pasos manuales extra.
#
# Nada de esto cambia el túnel en sí (sigue siendo el mismo quick tunnel
# efímero de Cloudflare) — es pura fricción menos para "mandale el link a mi
# amigo para que lo pruebe ahora".
if ! command -v qrencode &> /dev/null; then
  echo "📦 Instalando qrencode (para mostrar el link como QR)..."
  sudo apt-get install -y qrencode > /dev/null 2>&1 || echo "   (no se pudo instalar automáticamente, seguimos sin QR)"
fi

# Sistema "Túnel resiliente" (nuevo): un quick tunnel gratuito de Cloudflare
# se puede caer solo (red inestable, reinicio del lado de Cloudflare, etc.).
# Antes, si eso pasaba a mitad de la demo, el script simplemente terminaba y
# quien estaba probando Pit se quedaba con un link muerto sin previo aviso.
# Ahora el túnel se relanza solo si se cae, avisando en la terminal — la URL
# SÍ cambia en cada relanzamiento (es la naturaleza del quick tunnel), pero
# nunca te deja "colgado" sin loguear qué pasó ni sin intentar levantarlo de
# nuevo. Para frenarlo de una: Ctrl+C acá, o `./stop-share.sh` desde otra
# terminal (mata el túnel por su PID guardado, sin tocar docker compose).
echo $$ > .quick-share.pid

while true; do
  LOGFILE=$(mktemp)
  cloudflared tunnel --url http://localhost:3000 2>&1 | tee "$LOGFILE" &
  CF_PID=$!
  echo "$CF_PID" >> .quick-share.pid

  URL=""
  for i in $(seq 1 30); do
    URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' "$LOGFILE" | head -1)
    if [ -n "$URL" ]; then break; fi
    sleep 1
  done

  if [ -n "$URL" ]; then
    echo "$URL" > .last-share-url
    echo ""
    echo "✅ Pit ya está público en: $URL"
    echo "   (guardado en .last-share-url por si necesitás recuperarlo)"
    if command -v qrencode &> /dev/null; then
      echo ""
      echo "📱 Escaneá esto desde el celular para entrar directo:"
      qrencode -t ANSIUTF8 "$URL"
    fi
    echo ""
    echo "   Para frenar todo: Ctrl+C, o ./stop-share.sh desde otra terminal."
  else
    echo "⚠️  No se pudo detectar la URL pública automáticamente — revisá el log arriba."
  fi

  wait $CF_PID
  echo ""
  echo "⚠️  El túnel se cortó. Relanzando en 3 segundos (Ctrl+C para no reintentar)..."
  sleep 3
done
