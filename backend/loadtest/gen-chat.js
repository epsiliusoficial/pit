// Crea UN chat grupal real con todos los usuarios de load test como miembros,
// para que join_room contra ese chatId sea una membresía legítima (no bypassea
// la autorización que agregamos hace poco).
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const users = require('./users.json');

(async () => {
  const chat = await prisma.chat.create({
    data: {
      isGroup: true,
      name: 'Load Test Room',
      users: { create: users.map(u => ({ userId: u.userId, role: 'MEMBER' })) },
    },
  });
  require('fs').writeFileSync(__dirname + '/chat.json', JSON.stringify({ chatId: chat.id }));
  console.log('Chat de carga creado:', chat.id);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
