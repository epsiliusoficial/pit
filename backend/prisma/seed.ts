import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { encryptContent } from '../src/core/crypto/messageEncryption';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('pitbot123', 10);
  const bot = await prisma.user.upsert({
    where: { phone: '+1234567890' },
    update: {},
    create: {
      phone: '+1234567890',
      name: 'PitBot',
      publicKey: 'pitbot-public-key',
      privateKeyEnc: 'pitbot-private-key-enc',
      passwordHash,
      settings: { ghostMode: false, theme: 'dark', lang: 'es' }
    }
  });

  const chat = await prisma.chat.create({
    data: {
      isGroup: false,
      name: 'Bienvenido a Pit',
      users: { create: { userId: bot.id, role: 'ADMIN' } }
    }
  });

  await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: bot.id,
      content: encryptContent('Bienvenido a Pit 🚀'),
      contentType: 'TEXT'
    }
  });

  // Sistema "Stickers": pack de ejemplo real, no un mock — usable desde el día 1.
  const existingPack = await prisma.stickerPack.findFirst({ where: { name: 'Clásicos' } });
  if (!existingPack) {
    await prisma.stickerPack.create({
      data: {
        name: 'Clásicos',
        stickers: {
          create: [
            { emoji: '😂' }, { emoji: '❤️' }, { emoji: '🔥' }, { emoji: '👍' },
            { emoji: '🎉' }, { emoji: '😢' }, { emoji: '😮' }, { emoji: '🙏' }
          ]
        }
      }
    });
  }

  console.log('Seed completo: usuario PitBot, chat de bienvenida y pack de stickers creados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
