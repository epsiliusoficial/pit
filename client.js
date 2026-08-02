// Cliente de prueba real. Corré esto desde CUALQUIER máquina del mundo con internet,
// apuntando a tu servidor público (no localhost), y vas a poder chatear en tiempo real.
//
// Uso:
//   node client.js https://TUDOMINIO.com +5490000000 miclave123
//
// Requiere: npm install socket.io-client axios readline
const axios = require('axios');
const { io } = require('socket.io-client');
const readline = require('readline');

const [, , SERVER_URL, PHONE, PASSWORD] = process.argv;

if (!SERVER_URL || !PHONE || !PASSWORD) {
  console.log('Uso: node client.js https://TUDOMINIO.com +5490000000 miclave123');
  process.exit(1);
}

async function main() {
  // Pide OTP
  const { data: otpResp } = await axios.post(`${SERVER_URL}/api/auth/otp/request`, { phone: PHONE });
  console.log('OTP enviado. Si NODE_ENV=development en el server, acá está:', otpResp.devOtp);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const otp = await new Promise((resolve) => rl.question('Ingresá el OTP: ', resolve));
  const name = await new Promise((resolve) => rl.question('Tu nombre (solo si es registro nuevo): ', resolve));

  const { data: auth } = await axios.post(`${SERVER_URL}/api/auth/otp/verify`, {
    phone: PHONE, otp, name, password: PASSWORD
  });

  console.log(`Conectado como ${auth.user.name} (${auth.user.id})`);

  const socket = io(SERVER_URL, { auth: { token: auth.token } });

  socket.on('connect', () => console.log('Socket conectado al servidor real:', SERVER_URL));
  socket.on('new_message', (msg) => console.log(`\n[${msg.senderId}]: ${msg.content}`));
  socket.on('connect_error', (err) => console.error('Error de conexión:', err.message));

  rl.setPrompt('chatId:mensaje > ');
  rl.prompt();
  rl.on('line', async (line) => {
    const [chatId, ...rest] = line.split(':');
    const content = rest.join(':');
    if (chatId && content) {
      socket.emit('join_room', chatId);
      await axios.post(`${SERVER_URL}/api/chat/send`, { chatId, content }, {
        headers: { Authorization: `Bearer ${auth.token}` }
      });
    }
    rl.prompt();
  });
}

main().catch((e) => console.error(e.response?.data || e.message));
