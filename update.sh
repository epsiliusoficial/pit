#!/bin/bash
# Sistema "Actualizar en 1 comando": reconstruye y aplica nuevas migraciones sin downtime largo.
# Uso en el servidor, dentro de la carpeta pit-os/:
#   ./update.sh
set -e

echo "🔄 Actualizando Pit..."
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy
echo "✅ Pit actualizado y corriendo con la última versión."
