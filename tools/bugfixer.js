#!/usr/bin/env node
// Sistema "Bot Arreglador de Bugs": corre la suite de tests real, junta las
// fallas de verdad (no inventadas), y le pide a la IA un parche propuesto
// para cada una — mostrando el diff para que VOS decidas si se aplica.
//
// Por qué NUNCA aplica solo por defecto: un bot que edita código de un
// proyecto real sin que nadie lo revise es la forma más rápida de meter un
// bug peor que el que arregla, o de "arreglar" un test rompiendo el
// comportamiento real en vez del código con el bug. Este bot:
//   1. Corre los tests reales (nunca inventa fallas)
//   2. Le manda a la IA el error real + el archivo real involucrado
//   3. Muestra el diff propuesto, en texto, para que lo leas
//   4. Solo aplica con --apply, Y te pide confirmación explícita
//   5. Vuelve a correr los tests después de aplicar, para confirmar que el
//      parche realmente arregla lo que decía arreglar (no solo "parece
//      razonable")
//
// Uso:
//   node tools/bugfixer.js                  → detecta fallas, propone parches, no toca nada
//   node tools/bugfixer.js --apply           → además pregunta si aplicar cada parche
//   node tools/bugfixer.js --apply --yes     → aplica sin preguntar (para CI, bajo tu propio riesgo)

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const APPLY = process.argv.includes('--apply');
const AUTO_YES = process.argv.includes('--yes');
const MAX_FIXES_PER_RUN = 5; // tope real: no le pedimos a la IA que arregle 40 cosas de una

function log(msg) { console.log(msg); }

function runTests() {
  log('🧪 Corriendo la suite real de tests…\n');
  const result = spawnSync('npx', ['jest', '--json', '--outputFile=/tmp/bugfixer-jest-result.json'], {
    cwd: BACKEND_DIR, stdio: ['ignore', 'ignore', 'ignore']
  });
  const raw = fs.readFileSync('/tmp/bugfixer-jest-result.json', 'utf8');
  return JSON.parse(raw);
}

function extractFailures(jestResult) {
  const failures = [];
  for (const suite of jestResult.testResults || []) {
    for (const test of suite.assertionResults || []) {
      if (test.status !== 'failed') continue;
      failures.push({
        file: suite.name,
        testName: test.fullName,
        message: (test.failureMessages || []).join('\n').slice(0, 4000) // tope real, no mandamos stacktraces infinitos
      });
    }
  }
  return failures;
}

function guessSourceFile(testFilePath) {
  // Heurística real y simple: los tests de este repo casi siempre traen el
  // módulo real bajo prueba con un import dinámico
  // (`await import('../modules/x/y')`), no un `import ... from` estático —
  // así que buscamos ambos patrones.
  const content = fs.readFileSync(testFilePath, 'utf8');
  const match = content.match(/(?:from|import)\s*\(?\s*['"](\.\.\/[^'"]+)['"]/);
  if (!match) return null;
  const rel = match[1];
  const candidate = path.join(path.dirname(testFilePath), rel + '.ts');
  return fs.existsSync(candidate) ? candidate : null;
}

async function askOpenAIForFix(failure, sourceFile, sourceContent) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en el entorno — mismo requisito que el resto de las features de IA del proyecto.');
  }

  const systemPrompt = `Sos un asistente que propone parches MÍNIMOS y quirúrgicos para arreglar
UN test que falla en un proyecto TypeScript/Express real. Reglas:
- Cambiá lo MÍNIMO posible. Nunca reescribas un archivo entero si alcanza con 2 líneas.
- Si el problema parece estar en el TEST (el test está mal, no el código), decilo explícitamente
  en vez de forzar un cambio en el código de producción para que el test pase igual.
- Devolvé SOLO un bloque de diff unificado (formato git diff), nada de texto antes o después.
- Si no podés proponer un parche con confianza razonable, devolvé exactamente: NO_FIX_CONFIDENT`;

  const userContent = `Test que falla: ${failure.testName}
Archivo de test: ${failure.file}

Error real:
${failure.message}

Archivo de código fuente candidato (${sourceFile || 'no identificado automáticamente'}):
${sourceContent || '(no se pudo identificar el archivo fuente automáticamente — proponé el fix basado solo en el error si podés)'}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      temperature: 0
    })
  });
  if (!response.ok) throw new Error(`OpenAI respondió ${response.status}`);
  const data = await response.json();
  return data.choices[0].message.content.trim();
}

function confirm(question) {
  if (AUTO_YES) return Promise.resolve(true);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question + ' [y/N] ', answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'y'); });
  });
}

function applyDiff(diffText) {
  fs.writeFileSync('/tmp/bugfixer-patch.diff', diffText);
  const result = spawnSync('git', ['apply', '--check', '/tmp/bugfixer-patch.diff'], { cwd: REPO_ROOT });
  if (result.status !== 0) {
    log('❌ El diff propuesto no aplica limpiamente (git apply --check falló) — no se tocó nada.');
    return false;
  }
  spawnSync('git', ['apply', '/tmp/bugfixer-patch.diff'], { cwd: REPO_ROOT });
  return true;
}

async function main() {
  const before = runTests();
  const failures = extractFailures(before);

  if (failures.length === 0) {
    log('✅ No hay tests fallando. Nada que arreglar.');
    return;
  }

  log(`🐛 ${failures.length} test(s) fallando. Procesando hasta ${MAX_FIXES_PER_RUN} en esta corrida.\n`);

  for (const failure of failures.slice(0, MAX_FIXES_PER_RUN)) {
    log(`\n── ${failure.testName} ──`);
    log(`   archivo de test: ${failure.file}`);

    const sourceFile = guessSourceFile(failure.file);
    const sourceContent = sourceFile ? fs.readFileSync(sourceFile, 'utf8').slice(0, 8000) : null;

    let proposedFix;
    try {
      proposedFix = await askOpenAIForFix(failure, sourceFile, sourceContent);
    } catch (e) {
      log(`   ⚠️  No se pudo pedir un parche: ${e.message}`);
      continue;
    }

    if (proposedFix === 'NO_FIX_CONFIDENT') {
      log('   🤷 La IA no propuso un parche con confianza — requiere revisión manual.');
      continue;
    }

    log('\n   Parche propuesto:\n');
    log(proposedFix.split('\n').map(l => '   ' + l).join('\n'));

    if (!APPLY) continue;

    const shouldApply = await confirm('\n   ¿Aplicar este parche?');
    if (!shouldApply) { log('   Salteado.'); continue; }

    const applied = applyDiff(proposedFix);
    if (!applied) continue;

    log('   🧪 Re-corriendo tests para confirmar que esto arregla algo real (no solo "parece bien")…');
    const after = runTests();
    const stillFailing = extractFailures(after).some(f => f.testName === failure.testName);
    if (stillFailing) {
      log('   ❌ El test SIGUE fallando después del parche — revirtiendo.');
      spawnSync('git', ['apply', '-R', '/tmp/bugfixer-patch.diff'], { cwd: REPO_ROOT });
    } else {
      log('   ✅ Confirmado: el test pasa ahora. Parche aplicado y queda en tu working tree sin commitear — revisalo antes de commitear.');
    }
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
