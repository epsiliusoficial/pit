# Bot Arreglador de Bugs (tools/bugfixer.js)

Corre la suite de tests real de `backend/`, junta las fallas reales (no
inventadas), y le pide a la IA un parche propuesto para cada una — mostrando
siempre el diff en texto plano antes de tocar nada.

## Por qué NUNCA aplica solo por defecto

Un bot que edita código de un proyecto real sin que nadie lo revise es la
forma más rápida de meter un bug peor que el que arregla — o de "arreglar"
un test rompiendo el comportamiento real en vez del código con el problema.

## Uso

```bash
export OPENAI_API_KEY=tu-clave   # misma que usás para las demás features de IA
node tools/bugfixer.js                # solo detecta y propone, no toca nada
node tools/bugfixer.js --apply        # además pregunta antes de aplicar cada parche
node tools/bugfixer.js --apply --yes  # aplica sin preguntar (bajo tu propio riesgo, pensado para CI)
```

## Qué hace, paso a paso

1. Corre `npx jest` de verdad sobre `backend/`.
2. Por cada test que falla (hasta 5 por corrida — tope real para no pedirle
   a la IA que arregle 40 cosas de una), identifica el archivo fuente real
   más probable (heurística sobre los imports del propio test).
3. Le pide a la IA un diff unificado mínimo — puede negarse explícitamente
   (`NO_FIX_CONFIDENT`) en vez de forzar algo dudoso.
4. Con `--apply`, valida que el diff aplica limpio (`git apply --check`)
   antes de tocar nada.
5. Después de aplicar, vuelve a correr el test puntual — si sigue fallando,
   **revierte el parche automáticamente**. Nunca deja un parche que no
   demostró arreglar lo que decía arreglar.
6. Todo queda en tu working tree sin commitear — el commit lo hacés vos,
   después de revisarlo.

## Lo que NO hace (a propósito)

- No commitea nada.
- No corre en producción ni toca `main` directo.
- No "arregla" un test rompiendo el código real para que pase — si la IA
  sospecha que el test está mal, lo dice en vez de forzar el código.
- No procesa más de 5 fallas por corrida.

## Verificado antes de entregarlo

Se probó de verdad rompiendo una función real (`computeSafetyNumber` en
`safetyNumber.ts`) a propósito, y corriendo el bot contra esa falla real —
así se encontraron y corrigieron dos bugs reales del propio bot antes de
esta versión (nombre de campo incorrecto en el JSON de Jest, y una
heurística de detección de archivo fuente que no soportaba el patrón de
`import()` dinámico que usa este proyecto en sus tests).
