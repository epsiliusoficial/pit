#!/bin/bash
# Sistema "Deploy en 1 comando": automatiza TODO lo que antes eran 6 pasos manuales.
# Uso en tu VPS (Ubuntu/Debian):
#   chmod +x deploy.sh
#   ./deploy.sh tudominio.com
set -e

DOMAIN=$1
if [ -z "$DOMAIN" ]; then
  echo "Uso: ./deploy.sh tudominio.com"
  exit 1
fi

echo "🚀 Desplegando Pit en $DOMAIN..."

# 1. Instala Docker si no está
if ! command -v docker &> /dev/null; then
  echo "📦 Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Genera secretos reales si no existen
if [ ! -f .env ]; then
  echo "🔐 Generando secretos..."
  DB_PASS=$(openssl rand -hex 16)
  JWT_SEC=$(openssl rand -hex 32)
  # Bug crítico corregido: antes NO se generaban ADMIN_SECRET ni
  # ENCRYPTION_MASTER_KEY acá, pero el backend los EXIGE en producción (se
  # niega a arrancar o revienta en la primera acción real sin ellos). Con el
  # .env viejo, el deploy "funcionaba" a simple vista (el healthcheck pasa
  # apenas el proceso levanta) y recién explotaba al mandar el primer
  # mensaje o entrar al panel de admin — el peor tipo de bug para alguien
  # que se está autohospedando por primera vez.
  ADMIN_SEC=$(openssl rand -hex 32)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  cat > .env <<EOF
DB_PASSWORD=$DB_PASS
JWT_SECRET=$JWT_SEC
ADMIN_SECRET=$ADMIN_SEC
ENCRYPTION_MASTER_KEY=$ENCRYPTION_KEY
NODE_ENV=production
FRONTEND_URL=https://$DOMAIN
EOF
  echo "   Guardado en .env — hacé una copia de seguridad de este archivo,"
  echo "   sin ADMIN_SECRET/ENCRYPTION_MASTER_KEY no hay forma de recuperar"
  echo "   el acceso de admin ni los mensajes ya guardados."
fi

# 3. Configura el dominio en nginx
sed -i "s/TUDOMINIO.com/$DOMAIN/g" infrastructure/nginx/nginx.conf

# 4. Levanta nginx primero (necesario para el challenge de Let's Encrypt)
docker compose -f docker-compose.prod.yml up -d nginx

# 5. Emite el certificado SSL real y gratis
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos \
  -m "admin@$DOMAIN" || echo "⚠️  Si esto falla, verificá que el DNS de $DOMAIN ya apunte a este servidor."

# 6. Levanta todo el stack
docker compose -f docker-compose.prod.yml up -d

# 7. Migra la base de datos y siembra el usuario demo
docker compose -f docker-compose.prod.yml exec -T backend npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec -T backend npm run seed || true

echo ""
echo "✅ Pit está publicado en https://$DOMAIN"
echo "   Cualquier persona en el mundo ya puede entrar desde el navegador y usarlo."

# Sistema "Publicar aún más fácil" (mismo criterio que se agregó en
# quick-share.sh): confirmar de verdad que quedó arriba, en vez de asumirlo
# solo porque los comandos anteriores no tiraron error, y mostrar el link
# final como QR para no tener que tipearlo a mano en el celular.
echo ""
echo "⏳ Confirmando que https://$DOMAIN responde de verdad..."
if curl -sf "https://$DOMAIN/health" > /dev/null 2>&1; then
  echo "✅ Confirmado: el healthcheck real respondió OK."
else
  echo "⚠️  Los contenedores están arriba pero el healthcheck todavía no respondió."
  echo "   Puede tardar unos segundos más, o revisá 'docker compose -f docker-compose.prod.yml logs backend'."
fi

if ! command -v qrencode &> /dev/null; then
  sudo apt-get install -y qrencode > /dev/null 2>&1 || true
fi
if command -v qrencode &> /dev/null; then
  echo ""
  echo "📱 Escaneá esto desde el celular para entrar directo:"
  qrencode -t ANSIUTF8 "https://$DOMAIN"
fi
