// Sistema "Tareas Compartidas": to-do lists reales dentro de un chat.
// Verificación de membresía en TODOS los endpoints desde el diseño inicial
// (aprendiendo de los bugs de autorización que encontramos y corregimos en
// otros módulos durante las auditorías anteriores).
import { Router } from 'express';
import { prisma } from '../../core/database/client';
import { AuthRequest, authMiddleware } from '../auth/middleware';
import { io } from '../../index';

export const taskRouter = Router();
taskRouter.use(authMiddleware);

async function requireMembership(userId: string, chatId: string) {
  return prisma.chatUser.findUnique({ where: { userId_chatId: { userId, chatId } } });
}

taskRouter.post('/', async (req: AuthRequest, res) => {
  const { chatId, title, description, assignedTo, dueDate } = req.body;
  if (!chatId || !title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'chatId y title (no vacío) son requeridos' });
  }

  const member = await requireMembership(req.userId!, chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  if (assignedTo) {
    const assigneeMember = await requireMembership(assignedTo, chatId);
    if (!assigneeMember) return res.status(400).json({ error: 'El usuario asignado no pertenece a este chat' });
  }

  // Bug corregido: `new Date('cualquier-cosa-invalida')` no tira excepción,
  // devuelve un "Invalid Date" que Prisma recién rechaza al intentar
  // guardarlo — resultando en un 500 genérico en vez de un error claro.
  let parsedDueDate: Date | undefined;
  if (dueDate) {
    parsedDueDate = new Date(dueDate);
    if (Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ error: 'dueDate no es una fecha válida' });
    }
  }

  const task = await prisma.task.create({
    data: {
      chatId,
      title: title.trim(),
      description: description || undefined,
      assignedTo: assignedTo || undefined,
      createdBy: req.userId!,
      dueDate: parsedDueDate
    }
  });
  io.to(chatId).emit('task_created', task);
  return res.json(task);
});

taskRouter.get('/:chatId', async (req: AuthRequest, res) => {
  const { chatId } = req.params;
  const member = await requireMembership(req.userId!, chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const tasks = await prisma.task.findMany({
    where: { chatId },
    orderBy: [{ isDone: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }]
  });
  return res.json(tasks);
});

taskRouter.post('/:id/toggle', async (req: AuthRequest, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

  const member = await requireMembership(req.userId!, task.chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  const updated = await prisma.task.update({ where: { id: task.id }, data: { isDone: !task.isDone } });
  io.to(task.chatId).emit('task_updated', updated);
  return res.json(updated);
});

taskRouter.delete('/:id', async (req: AuthRequest, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });

  const member = await requireMembership(req.userId!, task.chatId);
  if (!member) return res.status(403).json({ error: 'No pertenecés a este chat' });

  if (task.createdBy !== req.userId) return res.status(403).json({ error: 'Solo quien creó la tarea puede borrarla' });

  await prisma.task.delete({ where: { id: task.id } });
  io.to(task.chatId).emit('task_deleted', { id: task.id });
  return res.json({ deleted: true });
});
