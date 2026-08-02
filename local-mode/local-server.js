// Sistema "Modo Local / Pit Offline": chat en tiempo real sin internet.
// Corre en una laptop o celular (Termux) conectado a la MISMA red WiFi/hotspot
// que tus amigos. No necesita Postgres, ni Redis, ni internet: usa SQLite
// (un archivo) y guarda todo en memoria + disco local.
// Es la pieza que permite usar Pit en una casa, oficina, evento, o zona sin señal.
//
// Uso:
//   node local-server.js
//   (después cada persona en la misma red abre http://IP-DE-ESTA-PC:4000 en su navegador)
//
// Para saber tu IP local: `ipconfig` (Windows) o `ip addr` (Linux/Termux)
// Nota: se usa un archivo JSON como almacenamiento (en vez de SQLite nativo)
// a propósito: cero dependencias que compilen binarios nativos, así este
// servidor corre igual en Windows, Linux, Mac o Termux (Android) sin instalar
// build tools. Para el volumen de un chat local esto es más que suficiente
// y sigue siendo persistencia real en disco, no en memoria.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DB_FILE = path.join(__dirname, 'pit-local-db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { messages: [], nextId: 1 };
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();

app.get('/health', (_req, res) => res.json({ status: 'ok', mode: 'local-offline' }));

app.get('/history', (_req, res) => {
  res.json(db.messages.slice(-100));
});

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    socket.data.name = name;
    io.emit('presence', { name, online: true });
  });

  socket.on('message', (content) => {
    const name = socket.data.name || 'Anónimo';
    const msg = { id: db.nextId++, sender: name, content, created_at: new Date().toISOString() };
    db.messages.push(msg);
    saveDB(db); // persistencia real en disco, sin depender de internet ni nube
    io.emit('message', msg); // se retransmite a todos en la misma red al instante
  });

  socket.on('disconnect', () => {
    if (socket.data.name) io.emit('presence', { name: socket.data.name, online: false });
  });
});

const PORT = 4000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pit Local (sin internet) corriendo en http://0.0.0.0:${PORT}`);
  console.log('Compartí tu IP local con la gente conectada a tu misma red WiFi/hotspot.');
});
