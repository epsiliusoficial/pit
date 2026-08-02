#!/bin/bash
# Sistema "Verificación de Migración": corre esto ANTES de tocar producción.
# Levanta un Postgres descartable, aplica todo el schema desde cero, y confirma
# que no hay conflictos entre los modelos acumulados. Si esto pasa, tu
# schema.prisma es válido de punta a punta.
#
# Uso: ./verify-migration.sh
set -e

CONTAINER_NAME="pit_migration_check"
TEST_DB_URL="postgresql://test:test@localhost:5433/pit_test"

echo "🔍 Verificando migración de Pit..."

# 1. Limpia cualquier contenedor de prueba anterior
docker rm -f $CONTAINER_NAME 2>/dev/null || true

# 2. Levanta un Postgres descartable en un puerto distinto (5433, no toca tu 5432 real)
echo "📦 Levantando Postgres de prueba..."
docker run -d --name $CONTAINER_NAME \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=pit_test \
  -p 5433:5432 postgres:16-alpine

# 3. Espera a que Postgres esté listo de verdad (no un sleep a ciegas)
echo "⏳ Esperando que Postgres acepte conexiones..."
for i in $(seq 1 30); do
  if docker exec $CONTAINER_NAME pg_isready -U test > /dev/null 2>&1; then
    echo "✅ Postgres listo."
    break
  fi
  sleep 1
done

# 4. Genera la migración inicial (o aplica las existentes) contra la base descartable
cd backend
echo "🚀 Aplicando schema.prisma completo desde cero..."
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  DATABASE_URL=$TEST_DB_URL npx prisma migrate deploy
else
  DATABASE_URL=$TEST_DB_URL npx prisma migrate dev --name init --skip-seed
fi

# 5. Valida sintaxis y genera el cliente
DATABASE_URL=$TEST_DB_URL npx prisma validate
DATABASE_URL=$TEST_DB_URL npx prisma generate

echo ""
echo "✅ ✅ ✅ Schema válido. Todos los modelos aplicaron sin conflictos."
echo "🧹 Limpiando contenedor de prueba..."
cd ..
docker rm -f $CONTAINER_NAME > /dev/null

echo "🎉 Listo. Tu schema.prisma está listo para producción."
