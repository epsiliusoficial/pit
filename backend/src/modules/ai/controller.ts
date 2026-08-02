// Sistema "Bots de IA": resumidor, traductor y corrector de tono reales, usando
// la API de OpenAI. Es código real (fetch real, parseo real) — funciona en
// cuanto pongas OPENAI_API_KEY en tu .env. Sin la key, devuelve un error
// claro (502 con el mensaje), no un mock silencioso.
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';
import { encryptContent, decryptContent } from '../../core/crypto/messageEncryption';

export const aiRouter = Router();
aiRouter.use(authMiddleware);

export async function callOpenAI(systemPrompt: string, userContent: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY no configurada en el servidor');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de OpenAI: ${response.status} ${errText}`);
  }
  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// Sistema "Resumidor" (idea original #57): resume los últimos N mensajes del chat.
aiRouter.post('/summarize/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const limit = Number(req.body.limit) || 100;

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const messages = await prisma.message.findMany({
    where: { chatId, isDeleted: false, contentType: 'TEXT' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { sender: { select: { name: true } } }
  });

  const transcript = messages.reverse().map((m: any) => `${m.sender.name}: ${decryptContent(m.content)}`).join('\n');

  try {
    const summary = await callOpenAI(
      'Resumí la siguiente conversación de chat en español, en 3-5 puntos claros y breves.',
      transcript
    );
    const summaryMsg = await prisma.message.create({
      data: { chatId, senderId: req.userId!, content: encryptContent(`📝 Resumen: ${summary}`), contentType: 'SYSTEM' }
    });
    io.to(chatId).emit('new_message', { ...summaryMsg, content: `📝 Resumen: ${summary}` });
    return res.json({ summary });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// Sistema "Traductor en tiempo real".
aiRouter.post('/translate', async (req: AuthRequest, res) => {
  const { text, targetLanguage } = req.body;
  if (!text || !targetLanguage) return res.status(400).json({ error: 'text y targetLanguage requeridos' });

  try {
    const translated = await callOpenAI(
      `Traducí el siguiente texto al idioma "${targetLanguage}". Respondé solo con la traducción, sin explicaciones.`,
      text
    );
    return res.json({ translated });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// Sistema "Corrector de tono" (idea original #88): detecta agresividad antes de enviar.
aiRouter.post('/tone-check', async (req: AuthRequest, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text requerido' });

  try {
    const verdict = await callOpenAI(
      'Analizá si el siguiente mensaje suena agresivo o podría herir a alguien. Respondé SOLO con "OK" si está bien, o con una sugerencia breve de cómo suavizarlo si no.',
      text
    );
    return res.json({ verdict });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});

// Sistema "Pit AI" (nuevo): un asistente al que le podés preguntar algo
// DENTRO de un chat (ej: "@Pit ¿qué quedamos de hacer el sábado?") y te
// contesta usando el historial real de esa conversación como contexto —
// no un chatbot genérico, sino uno que ya sabe de qué se viene hablando.
//
// Reusa 100% del mismo mecanismo que ya existía para el Resumidor: mismo
// callOpenAI, mismo armado de transcript a partir de mensajes reales
// descifrados, misma verificación de membership, y la respuesta se publica
// como un mensaje real en el chat (contentType SYSTEM, prefijo "🤖 Pit AI:")
// para que todos los miembros la vean, no solo quien preguntó.
aiRouter.post('/ask/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const { question } = req.body;
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question (no vacía) es requerida' });
  }

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const messages = await prisma.message.findMany({
    where: { chatId, isDeleted: false, contentType: 'TEXT' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { sender: { select: { name: true } } }
  });
  const transcript = messages.reverse().map((m: any) => `${m.sender.name}: ${decryptContent(m.content)}`).join('\n');

  try {
    const answer = await callOpenAI(
      'Sos un asistente dentro de un chat grupal. Te paso el historial reciente de la conversación y una ' +
      'pregunta de uno de los participantes. Respondé la pregunta en español, en forma breve y concreta, ' +
      'usando el historial como contexto cuando sea relevante. Si el historial no tiene la respuesta, decilo.',
      `Historial:\n${transcript}\n\nPregunta: ${question}`
    );
    const answerMsg = await prisma.message.create({
      data: { chatId, senderId: req.userId!, content: encryptContent(`🤖 Pit AI: ${answer}`), contentType: 'SYSTEM' }
    });
    io.to(chatId).emit('new_message', { ...answerMsg, content: `🤖 Pit AI: ${answer}` });
    return res.json({ answer });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
// respuesta basadas en el último mensaje real del chat — mismo patrón que el
// resumidor y el traductor de arriba (misma verificación de membership, mismo
// callOpenAI, mismo manejo de error 502 explícito sin OPENAI_API_KEY).
// A diferencia del resumidor, esto NO escribe ningún mensaje nuevo en el chat
// — son solo sugerencias que la UI muestra como chips; el usuario elige una,
// la edita o no la usa, y recién ahí se manda como un mensaje normal.
aiRouter.get('/smart-replies/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;

  const member = await prisma.chatUser.findUnique({
    where: { userId_chatId: { userId: req.userId!, chatId } }
  });
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const lastMessage = await prisma.message.findFirst({
    where: { chatId, isDeleted: false, contentType: 'TEXT', senderId: { not: req.userId! } },
    orderBy: { createdAt: 'desc' }
  });

  if (!lastMessage) return res.json({ suggestions: [] });

  const plainText = decryptContent((lastMessage as any).content);

  try {
    const raw = await callOpenAI(
      'Dado este último mensaje de un chat, sugerí exactamente 3 posibles respuestas cortas (menos de 8 palabras cada una) que la otra persona podría querer mandar. Respondé SOLO con las 3 opciones separadas por "|", sin numerarlas ni agregar nada más.',
      plainText
    );
    const suggestions = raw.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 3);
    return res.json({ suggestions });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
});
