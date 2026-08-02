import fs from 'fs';
import path from 'path';

describe('Seed script — el mensaje de bienvenida debe estar cifrado (bug corregido)', () => {
  it('usa encryptContent al crear el mensaje, no un string plano', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../prisma/seed.ts'), 'utf8');
    expect(source).toContain("import { encryptContent } from '../src/core/crypto/messageEncryption'");
    expect(source).toContain("content: encryptContent('Bienvenido a Pit 🚀')");
  });
});
