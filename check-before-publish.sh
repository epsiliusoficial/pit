#!/bin/bash
# Sistema "Chequeo Pre-Publicación" (nuevo): antes esto no existía — la
# primera vez que alguien corría deploy.sh o quick-share.sh, si faltaba
# ENCRYPTION_MASTER_KEY o JWT_SECRET, el error salía recién cuando el
# servidor ya intentaba arrancar (fail-fast por diseño, correcto, pero
# tarde: ya perdiste el tiempo de levantar Docker). Esto valida ANTES de
# tocar Docker, con un check por variable y qué generarla si falta.
#
# Uso:
#   ./check-before-publish.sh          → solo revisa y avisa qué falta
#   ./check-before-publish.sh --fix    → además genera y escribe las claves
#                                          que falten directo en backend/.env,
#                                          sin que tengas que copiar/pegar
#                                          comandos de node a mano.
set -e

FIX_MODE=false
[ "$1" == "--fix" ] && FIX_MODE=true

# Sistema "Chequeo de Docker" (nuevo): la causa más básica de todas para
# fallar publicando — ni deploy.sh ni quick-share.sh funcionan sin Docker
# corriendo, y hasta ahora el error aparecía recién adentro de esos
# scripts, a veces con un mensaje críptico de "connection refused". Esto lo
# chequea de entrada, con un mensaje que dice exactamente qué hacer.
if ! command -v docker &> /dev/null; then
  echo "❌ Docker no está instalado. Instalalo desde https://docs.docker.com/get-docker/ y volvé a correr esto."
  exit 1
fi
if ! docker info &> /dev/null; then
  echo "❌ Docker está instalado pero no está corriendo. Iniciá Docker Desktop (o el servicio docker) y volvé a intentar."
  exit 1
fi
echo "✅ Docker instalado y corriendo"

ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example "$ENV_FILE"
    echo "ℹ️  No existía $ENV_FILE — se creó copiando .env.example."
  else
    echo "❌ No existe $ENV_FILE ni .env.example para copiar."
    exit 1
  fi
fi

gen_secret() { node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"; }

# Escribe (o reemplaza) una variable en backend/.env — usado por --fix para
# no dejar al usuario copiando valores generados a mano al archivo.
set_env_var() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    echo "${key}=${value}" >> "$ENV_FILE"
  fi
}

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

FAIL=0
warn_missing() {
  echo "⚠️  $1 no está configurada. $2"
  FAIL=1
}
ok() { echo "✅ $1"; }

[ -n "$DATABASE_URL" ] && ok "DATABASE_URL configurada" || warn_missing "DATABASE_URL" "Necesaria siempre (no se puede autogenerar, es tuya)."

if [ -n "$ENCRYPTION_MASTER_KEY" ]; then
  ok "ENCRYPTION_MASTER_KEY configurada (cifrado de mensajes en reposo)"
elif [ "$FIX_MODE" == true ]; then
  set_env_var ENCRYPTION_MASTER_KEY "$(gen_secret)"
  ok "ENCRYPTION_MASTER_KEY generada y guardada en $ENV_FILE"
else
  warn_missing "ENCRYPTION_MASTER_KEY" "Corré ./check-before-publish.sh --fix para generarla sola."
fi

if [ -n "$JWT_SECRET" ] && [ "$JWT_SECRET" != "cambia_esto_en_produccion" ]; then
  ok "JWT_SECRET configurada (no es el valor de ejemplo)"
elif [ "$FIX_MODE" == true ]; then
  set_env_var JWT_SECRET "$(gen_secret)"
  ok "JWT_SECRET generada y guardada en $ENV_FILE"
else
  warn_missing "JWT_SECRET" "Corré ./check-before-publish.sh --fix para generarla sola."
fi

if [ -n "$ADMIN_SECRET" ] && [ "$ADMIN_SECRET" != "cambia_esto_por_una_clave_larga_random" ]; then
  ok "ADMIN_SECRET configurada (no es el valor de ejemplo)"
elif [ "$FIX_MODE" == true ]; then
  set_env_var ADMIN_SECRET "$(gen_secret)"
  ok "ADMIN_SECRET generada y guardada en $ENV_FILE"
else
  warn_missing "ADMIN_SECRET" "Solo importa si usás el panel /admin. Corré --fix para generarla sola."
fi

if [ -n "$OPENAI_API_KEY" ]; then
  ok "OPENAI_API_KEY configurada (Resúmenes, Pit AI, Traducción, Transcripción de voz van a funcionar)"
else
  echo "ℹ️  OPENAI_API_KEY no configurada — Pit funciona igual, pero las funciones de IA (Resumen,"
  echo "   Pit AI, Traducción Automática, Transcripción de voz) van a devolver error hasta que la definas."
  echo "   (Esta no se puede autogenerar — es tu clave de OpenAI, hay que pegarla a mano.)"
fi

echo ""
if [ "$FIX_MODE" == true ]; then
  echo "🔧 Modo --fix: se generaron las claves que faltaban. Volvé a correr sin --fix para confirmar."
elif [ "$FAIL" -eq 0 ]; then
  echo "🚀 Todo listo. Ya podés correr ./deploy.sh o ./quick-share.sh con confianza."
else
  echo "🛑 Hay configuración obligatoria pendiente. Corré ./check-before-publish.sh --fix para resolverlo solo,"
  echo "   o arreglalo a mano y volvé a correr este script."
  exit 1
fi

# Sistema "Chequeo de puerto ocupado" (nuevo): otra causa clásica de perder
# tiempo publicando — el puerto 3000 ya está tomado por otra cosa (una
# corrida anterior de Pit que no se cerró bien, u otro proceso cualquiera)
# y el error recién aparece cuando Docker ya intentó levantar el contenedor.
if command -v lsof &> /dev/null && lsof -i :3000 &> /dev/null; then
  echo ""
  echo "⚠️  El puerto 3000 ya está en uso — Pit puede no arrancar bien."
  echo "   Si es una corrida anterior de Pit, pará los contenedores con:"
  echo "   docker compose down"
fi
