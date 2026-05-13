const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Parse un SMS ou une notification pour détecter si une opération est un succès ou un échec.
 * Les patterns sont configurables par opérateur depuis la plateforme Admin.
 */
const parseConfirmation = async (operator, operationType, message) => {
  const config = await prisma.operatorConfig.findUnique({
    where: { operator }
  });

  if (!config) {
    return { status: 'UNKNOWN', transactionId: null, reason: 'Opérateur non configuré' };
  }

  const msg = message.toLowerCase();

  // Patterns d'échec (priorité sur succès)
  if (config.smsFailurePatterns) {
    const failurePatterns = config.smsFailurePatterns.split('\n').filter(p => p.trim());
    for (const pattern of failurePatterns) {
      try {
        if (new RegExp(pattern.trim(), 'i').test(message)) {
          return { status: 'FAILED', transactionId: null, reason: `Pattern échec: ${pattern}` };
        }
      } catch (e) {}
    }
  }

  // Pattern succès selon type d'opération
  let successPattern = null;
  if (operationType === 'DEPOT') {
    successPattern = config.usesNotification
      ? config.notifSuccessDepot
      : config.smsSuccessDepot;
  } else {
    successPattern = config.usesNotification
      ? config.notifSuccessRetrait
      : config.smsSuccessRetrait;
  }

  if (successPattern) {
    try {
      const regex = new RegExp(successPattern.trim(), 'i');
      const match = message.match(regex);
      if (match) {
        // Extraire l'ID de transaction (groupe capturant nommé ou premier groupe)
        const transactionId = match.groups?.txid || match.groups?.id || match[1] || null;
        return { status: 'SUCCESS', transactionId, reason: null };
      }
    } catch (e) {}
  }

  return { status: 'UNKNOWN', transactionId: null, reason: 'Aucun pattern ne correspond' };
};

/**
 * Construire le code USSD pour une opération donnée.
 * Le code peut contenir des placeholders: {montant}, {numero}, {pin}
 */
const buildUssdCode = (template, { amount, phoneNumber, pin }) => {
  if (!template) return null;
  return template
    .replace('{montant}', amount)
    .replace('{numero}', phoneNumber)
    .replace('{pin}', pin || '');
};

/**
 * Traiter le résultat reçu de l'app Android et mettre à jour l'opération.
 */
const processAndroidResult = async (operationId, message, isNotification = false) => {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { operatorConfig: true }
  });

  if (!operation) throw new Error('Opération introuvable');
  if (operation.status === 'SUCCESS' || operation.status === 'FAILED') {
    return operation; // Déjà traitée
  }

  const result = await parseConfirmation(
    operation.operator,
    operation.type,
    message
  );

  const updates = {
    confirmationMessage: message,
    confirmationReceivedAt: new Date(),
    notes: result.reason,
  };

  if (result.status === 'SUCCESS') {
    updates.status = 'SUCCESS';
    updates.operatorTransactionId = result.transactionId;
  } else if (result.status === 'FAILED') {
    updates.status = 'FAILED';
  }
  // UNKNOWN → reste en PROCESSING, attendre d'autres messages

  const updated = await prisma.operation.update({
    where: { id: operationId },
    data: updates,
    include: { user: true, operatorConfig: true }
  });

  // Log
  await prisma.operationLog.create({
    data: {
      operationId,
      message: `${isNotification ? 'Notification' : 'SMS'} reçu: "${message.substring(0, 100)}" → Statut: ${result.status}`,
      level: result.status === 'FAILED' ? 'ERROR' : 'INFO'
    }
  });

  return updated;
};

module.exports = { parseConfirmation, buildUssdCode, processAndroidResult };
