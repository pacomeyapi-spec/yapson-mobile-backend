const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateDevice } = require('../middleware/auth');
const { processAndroidResult } = require('../services/smsParser');
const { notifyOperationUpdate } = require('../services/websocket');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * L'app Android envoie les résultats ici.
 * Toutes les routes utilisent le token de l'appareil (x-device-token).
 */

// Récupérer les opérations PENDING en attente de traitement pour cet appareil
const { buildUssdSteps } = require('../services/smsParser');

router.get('/pending', authenticateDevice, async (req, res) => {
  try {
    // Filtrer selon les opérateurs assignés à cet appareil
    let operatorFilter = {};
    if (req.device.operators) {
      try {
        const assignedOperators = JSON.parse(req.device.operators);
        if (Array.isArray(assignedOperators) && assignedOperators.length > 0) {
          operatorFilter = { operator: { in: assignedOperators } };
        }
      } catch (e) {}
    }

    const operations = await prisma.operation.findMany({
      where: { status: 'PENDING', deviceId: null, ...operatorFilter },
      include: { operatorConfig: true },
      orderBy: { createdAt: 'asc' },
      take: 10
    });

    // Calculer les ussdSteps pour chaque opération si pas encore présents
    const enriched = operations.map(op => {
      const config = op.operatorConfig;
      if (!config) return op;

      const stepsJson = op.type === 'DEPOT'
        ? config.ussdStepsDepot
        : config.ussdStepsRetrait;

      const ussdSteps = buildUssdSteps(stepsJson, {
        amount: op.amount,
        phoneNumber: op.phoneNumber,
        validationCode: config.validationCode
      });

      return { ...op, ussdSteps: ussdSteps.length > 0 ? ussdSteps : null };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// L'app Android prend en charge une opération (passe en PROCESSING)
router.post('/take/:operationId', authenticateDevice, async (req, res) => {
  try {
    const operation = await prisma.operation.findUnique({
      where: { id: req.params.operationId }
    });
    if (!operation) return res.status(404).json({ error: 'Opération non trouvée' });
    if (operation.status !== 'PENDING') {
      return res.status(409).json({ error: 'Opération déjà prise en charge' });
    }
    const updated = await prisma.operation.update({
      where: { id: req.params.operationId },
      data: { status: 'PROCESSING', deviceId: req.device.deviceId },
      include: { operatorConfig: true }
    });
    await prisma.operationLog.create({
      data: {
        operationId: operation.id,
        message: `Prise en charge par appareil: ${req.device.name} (${req.device.deviceId})`,
        level: 'INFO'
      }
    });
    notifyOperationUpdate(updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Réception d'un SMS de confirmation
router.post('/sms', authenticateDevice, async (req, res) => {
  const { operationId, message, sender, receivedAt } = req.body;
  if (!message) return res.status(400).json({ error: 'message requis' });

  try {
    // Si operationId fourni, traiter directement
    if (operationId) {
      const updated = await processAndroidResult(operationId, message, false);
      notifyOperationUpdate(updated);
      return res.json({ processed: true, operationId, status: updated.status });
    }

    // Sinon, chercher une opération PROCESSING récente correspondante
    const recentOps = await prisma.operation.findMany({
      where: {
        status: 'PROCESSING',
        deviceId: req.device.deviceId,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) } // 10 min
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    let matchedOp = null;
    for (const op of recentOps) {
      const { parseConfirmation } = require('../services/smsParser');
      const result = await parseConfirmation(op.operator, op.type, message);
      if (result.status !== 'UNKNOWN') {
        matchedOp = op;
        break;
      }
    }

    if (matchedOp) {
      const updated = await processAndroidResult(matchedOp.id, message, false);
      notifyOperationUpdate(updated);
      return res.json({ processed: true, operationId: matchedOp.id, status: updated.status });
    }

    // SMS non rattaché, le loguer quand même
    await prisma.operationLog.create({
      data: {
        operationId: recentOps[0]?.id || 'unknown',
        message: `SMS non rattaché reçu de ${sender}: "${message.substring(0, 100)}"`,
        level: 'WARN'
      }
    }).catch(() => {});

    res.json({ processed: false, message: 'Aucune opération correspondante trouvée' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Réception d'une notification Wave
router.post('/notification', authenticateDevice, async (req, res) => {
  const { operationId, packageName, title, text, receivedAt } = req.body;
  if (!text) return res.status(400).json({ error: 'text requis' });

  // Vérifier que la notification vient bien de Wave
  const waveConfig = await prisma.operatorConfig.findUnique({
    where: { operator: 'WAVE' }
  });
  if (waveConfig?.notifPackageName && packageName !== waveConfig.notifPackageName) {
    return res.json({ processed: false, message: 'Package non reconnu pour Wave' });
  }

  const fullMessage = `${title || ''} ${text}`.trim();

  try {
    if (operationId) {
      const updated = await processAndroidResult(operationId, fullMessage, true);
      notifyOperationUpdate(updated);
      return res.json({ processed: true, operationId, status: updated.status });
    }

    // Chercher l'opération Wave PROCESSING récente
    const waveOps = await prisma.operation.findMany({
      where: {
        operator: 'WAVE',
        status: 'PROCESSING',
        deviceId: req.device.deviceId,
        createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) }
      },
      orderBy: { createdAt: 'desc' },
      take: 3
    });

    if (waveOps.length > 0) {
      const updated = await processAndroidResult(waveOps[0].id, fullMessage, true);
      notifyOperationUpdate(updated);
      return res.json({ processed: true, operationId: waveOps[0].id, status: updated.status });
    }

    res.json({ processed: false, message: 'Aucune opération Wave en cours' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Heartbeat de l'app Android
router.post('/heartbeat', authenticateDevice, async (req, res) => {
  res.json({
    ok: true,
    deviceId: req.device.deviceId,
    name: req.device.name,
    serverTime: new Date().toISOString()
  });
});

module.exports = router;
