// Genera N usuarios reales en la DB de test + sus JWT, para el load test.
// Reutiliza el mismo jwtSecret y el mismo modelo Prisma que usa el server real
// (no son tokens falsos ni usuarios mockeados aparte del sistema).
require('dotenv/config');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const N = parseInt(process.argv[2] || '500', 10);
const secret = process.env.JWT_SECRET;

if (!secret) {
  console.error('Falta JWT_SECRET en el entorno (mismo que usa el backend).');
  process.exit(1);
}

(async () => {
  const users = [];
  for (let i = 0; i < N; i++) {
    const phone = `+549000${String(i).padStart(6, '0')}`;
    const user = await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        phone,
        name: `Loadtest ${i}`,
        publicKey: `loadtest-pubkey-${i}`,
        privateKeyEnc: `loadtest-privkey-enc-${i}`,
        passwordHash: await bcrypt.hash('loadtest-pass', 4),
      },
    });
    const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '2h' });
    users.push({ userId: user.id, token });
  }
  require('fs').writeFileSync(__dirname + '/users.json', JSON.stringify(users, null, 2));
  console.log(`Generados ${users.length} usuarios reales + JWT en loadtest/users.json`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
