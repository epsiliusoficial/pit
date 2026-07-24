// Sistema "Detector de Cuentas Falsas/Spam": heurísticas reales de
// comportamiento, no una IA externa ni una lista negra — los mismos
// patrones que usan Discord/Twitter para las primeras señales automáticas
// (después de las cuales un humano revisa, no se banea automático).
export interface AccountRiskReport {
  userId: string;
  riskScore: number; // 0-100, cuantos más puntos, más señales de riesgo
  flags: string[];
}

export interface AccountSignals {
  userId: string;
  accountAgeHours: number;
  messagesSentTotal: number;
  distinctChatsMessagedLastHour: number;
  hasAvatar: boolean;
  hasBio: boolean;
  isVerified: boolean;
  reportsAgainstUser: number;
}

export function analyzeAccountRisk(signals: AccountSignals): AccountRiskReport {
  const flags: string[] = [];
  let riskScore = 0;

  if (signals.isVerified) {
    return { userId: signals.userId, riskScore: 0, flags: ['Cuenta verificada'] };
  }

  if (signals.accountAgeHours < 1 && signals.distinctChatsMessagedLastHour >= 10) {
    flags.push('Cuenta con menos de 1 hora de antigüedad escribiendo en 10+ chats distintos');
    riskScore += 40;
  } else if (signals.accountAgeHours < 24 && signals.distinctChatsMessagedLastHour >= 20) {
    flags.push('Cuenta con menos de 1 día de antigüedad escribiendo en 20+ chats distintos');
    riskScore += 30;
  }

  if (!signals.hasAvatar && !signals.hasBio && signals.messagesSentTotal > 50) {
    flags.push('Perfil sin completar (sin foto ni bio) con alto volumen de mensajes');
    riskScore += 15;
  }

  if (signals.reportsAgainstUser >= 3) {
    flags.push(`${signals.reportsAgainstUser} reportes de otros usuarios en su contra`);
    riskScore += Math.min(signals.reportsAgainstUser * 10, 50);
  }

  const messagesPerHour = signals.messagesSentTotal / Math.max(signals.accountAgeHours, 1);
  if (messagesPerHour > 100) {
    flags.push('Volumen de mensajes por hora anormalmente alto para la antigüedad de la cuenta');
    riskScore += 20;
  }

  return { userId: signals.userId, riskScore: Math.min(riskScore, 100), flags };
}
