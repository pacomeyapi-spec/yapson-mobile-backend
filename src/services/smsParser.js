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

        // Extraire et normaliser le montant (remplacer virgule par point)
        let amount = match.groups?.montant || match.groups?.amount || null;
        if (amount) {
          amount = parseFloat(amount.replace(',', '.')) || null;
        }

        // Extraire le numéro si présent
        const phoneNumber = match.groups?.numero || match.groups?.phone || null;

        return { status: 'SUCCESS', transactionId, amount, phoneNumber, reason: null };
      }
    } catch (e) {}
  }

  return { status: 'UNKNOWN', transactionId: null, amount: null, phoneNumber: null, reason: 'Aucun pattern ne correspond' };
};

/**
 * Construire la séquence USSD multi-étapes pour une opération donnée.
 * Remplace les variables: {NUMERO}, {MONTANT}, {CODE}
 * Retourne un tableau d'étapes ordonnées.
 */
const buildUssdSteps = (stepsJson, { amount, phoneNumber, validationCode }) => {
  if (!stepsJson) return [];
  let steps = [];
  try {
    steps = JSON.parse(stepsJson);
  } catch (e) {
    return [];
  }
  return steps.map(step =>
    step
      .replace(/\{NUMERO\}/gi, phoneNumber || '')
      .replace(/\{MONTANT\}/gi, amount || '')
      .replace(/\{CODE\}/gi, validationCode || '')
  );
};

/**
 * Construire le code USSD pour une opération donnée (compatibilité ancien format).
 * Le code peut contenir des placeholders: {MONTANT}, {NUMERO}, {CODE}
 */
const buildUssdCode = (template, { amount, phoneNumber, validationCode, pin }) => {
  if (!template) return null;
  return template
    .replace(/\{MONTANT\}/gi, amount)
    .replace(/\{NUMERO\}/gi, phoneNumber)
    .replace(/\{CODE\}/gi, validationCode || pin || '')
    // Compatibilité anciens placeholders minuscules
    .replace(/\{montant\}/gi, amount)
    .replace(/\{numero\}/gi, phoneNumber)
    .replace(/\{pin\}/gi, validationCode || pin || '');
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
    // Mettre à jour le montant si extrait du SMS et différent (correction décimale)
    if (result.amount && result.amount !== operation.amount) {
      updates.amount = result.amount;
      await prisma.operationLog.create({
        data: {
          operationId,
          message: `Montant corrigé depuis SMS: ${operation.amount} → ${result.amount}`,
          level: 'INFO'
        }
      });
    }
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

module.exports = { parseConfirmation, buildUssdCode, buildUssdSteps, processAndroidResult };
