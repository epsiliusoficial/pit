#!/bin/bash
# Compañero de quick-share.sh: frena el túnel público (y su loop de
# auto-reintento) sin tener que volver a la terminal donde lo lanzaste ni
# tocar docker compose (Pit sigue corriendo en local, solo deja de ser
# público). Lee los PIDs guardados por quick-share.sh en .quick-share.pid.
#
# Uso:
#   ./stop-share.sh
set -e

if [ ! -f .quick-share.pid ]; then
  echo "No hay ningún túnel de quick-share corriendo (no existe .quick-share.pid)."
  exit 0
fi

while read -r PID; do
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
  fi
done < .quick-share.pid

rm -f .quick-share.pid
echo "✅ Túnel público detenido. Pit sigue corriendo en local (http://localhost:3000)."
echo "   Para bajar Pit del todo: docker compose down"
