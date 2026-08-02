// Sistema "Niveles": XP calculado a partir de actividad REAL ya trackeada
// (mensajes enviados, racha, logros desbloqueados) — no un contador
// decorativo aparte, se deriva de datos que ya existen en el sistema.
export interface LevelProgress {
  level: number;
  xp: number;
  xpForCurrentLevel: number;
  xpForNextLevel: number;
  progressPercent: number;
}

// Curva de XP: el nivel 1 arranca en 0 XP (todo usuario nuevo empieza ahí),
// y cada nivel siguiente pide progresivamente más — progresión cuadrática
// suave, evita que subir de nivel sea trivial ni imposible.
function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.5));
}

export function calculateXp(params: {
  messagesSent: number;
  longestStreak: number;
  achievementsUnlocked: number;
}): number {
  const xpFromMessages = params.messagesSent * 1;
  const xpFromStreak = params.longestStreak * 15;
  const xpFromAchievements = params.achievementsUnlocked * 50;
  return xpFromMessages + xpFromStreak + xpFromAchievements;
}

export function calculateLevelProgress(xp: number): LevelProgress {
  let level = 1;
  while (xpRequiredForLevel(level + 1) <= xp) {
    level++;
  }

  const xpForCurrentLevel = xpRequiredForLevel(level);
  const xpForNextLevel = xpRequiredForLevel(level + 1);
  const xpIntoLevel = xp - xpForCurrentLevel;
  const xpNeededForLevel = xpForNextLevel - xpForCurrentLevel;
  const progressPercent = Math.min(Math.round((xpIntoLevel / xpNeededForLevel) * 100), 100);

  return { level, xp, xpForCurrentLevel, xpForNextLevel, progressPercent };
}
