// Build real (sin frameworks pesados): copia los archivos estáticos a dist/
// e inyecta la URL del backend de Render, tomada de la variable de entorno
// BACKEND_URL que configurás en el dashboard de Vercel. Si no está definida,
// queda vacío y el usuario la escribe a mano (comportamiento actual, intacto).
const fs = require('fs');
const path = require('path');

const SRC = __dirname;
const DIST = path.join(__dirname, 'dist');

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });
fs.mkdirSync(DIST);

const files = ['index.html', 'manifest.json', 'sw.js', 'icon.svg'];
for (const file of files) {
  const srcPath = path.join(SRC, file);
  if (!fs.existsSync(srcPath)) continue;

  let content = fs.readFileSync(srcPath, 'utf8');
  if (file === 'index.html') {
    const backendUrl = process.env.BACKEND_URL || '';
    content = content.replace('__BACKEND_URL__', backendUrl);
  }
  fs.writeFileSync(path.join(DIST, file), content);
}

console.log('✅ Build de Pit frontend listo en dist/');
console.log(process.env.BACKEND_URL
  ? `   Backend precargado: ${process.env.BACKEND_URL}`
  : '   BACKEND_URL no definida — el usuario deberá escribirla a mano.');
