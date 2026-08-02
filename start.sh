#!/bin/bash
# Sistema "Un Solo Comando" (nuevo): antes, para publicar Pit por primera
# vez había que saber que existían 2-3 scripts distintos y correrlos en
# orden (check-before-publish.sh --fix, después quick-share.sh). Esto los
# encadena en un solo comando real para quien nunca usó Pit y solo quiere
# que ya esté andando:
#
#   ./start.sh
#
# Hace, en orden, parando si algo falla de verdad:
# 1. check-before-publish.sh --fix  → genera las claves que falten
# 2. quick-share.sh                 → levanta Pit y lo publica con QR
#
# No reemplaza a los scripts individuales (siguen sirviendo solitos para
# quien ya sabe lo que quiere) — esto es la puerta de entrada para la
# primera vez.
set -e

echo "1/2 — Revisando y completando la configuración..."
./check-before-publish.sh --fix

echo ""
echo "2/2 — Levantando Pit y publicándolo..."
exec ./quick-share.sh
