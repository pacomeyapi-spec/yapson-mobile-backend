const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { buildUssdCode } = require('../services/smsParser');
const { notifyOperationUpdate } = require('../services/websocket');

const router = express.Router();
const prisma = new PrismaClient();

// Créer une opération
router.post('/', authenticate, async (req, res) => {
  const { type, operator, amount, phoneNumber } = req.body;
  if (!type || !operator || !amount || !phoneNumber) {
    return res.status(400).json({ error: 'Champs requis: type, operator, amount, phoneNumber' });
  }
  if (!['DEPOT', 'RETRAIT'].includes(type)) {
    return res.status(400).json({ error: 'Type invalide (DEPOT ou RETRAIT)' });
  }
  if (!['ORANGE', 'MTN', 'MOOV', 'WAVE'].includes(operator)) {
    return res.status(400).json({ error: 'Opérateur invalide' });
  }
  try {
    const opConfig = await prisma.operatorConfig.findUnique({
      where: { operator }
    });
    if (!opConfig || !opConfig.isActive) {
      return res.status(400).json({ error: 'Opérateur non configuré ou inactif' });
    }

    // Construire le code USSD
    const ussdTemplate = type === 'DEPOT' ? opConfig.ussdDepot : opConfig.ussdRetrait;
    const ussdCode = buildUssdCode(ussdTemplate, { amount, phoneNumber });

    const operation = await prisma.operation.create({
      data: {
        type,
        operator,
        amount: parseFloat(amount),
        phoneNumber,
        userId: req.user.id,
        operatorConfigId: opConfig.id,
        ussdCode,
        status: 'PENDING'
      },
      include: { user: { select: { id: true, username: true } }, operatorConfig: true }
    });

    await prisma.operationLog.create({
      data: {
        operationId: operation.id,
        message: `Opération créée par ${req.user.username}: ${type} ${amount} FCFA via ${operator}`,
        level: 'INFO'
      }
    });

    notifyOperationUpdate(operation);
    res.status(201).json(operation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lister les opérations (avec filtres)
router.get('/', authenticate, async (req, res) => {
  const { status, operator, type, from, to, page = 1, limit = 50 } = req.query;
  const where = {};

  // Un user simple ne voit que ses propres opérations
  if (req.user.role !== 'ADMIN') {
    where.userId = req.user.id;
  }
  if (status) where.status = status;
  if (operator) where.operator = operator;
  if (type) where.type = type;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  try {
    const [operations, total] = await Promise.all([
      prisma.operation.findMany({
        where,
        include: { user: { select: { id: true, username: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit)
      }),
      prisma.operation.count({ where })
    ]);
    res.json({ operations, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Détail d'une opération
router.get('/:id', authenticate, async (req, res) => {
  try {
    const operation = await prisma.operation.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, username: true } },
        operatorConfig: true,
        logs: { orderBy: { createdAt: 'asc' } }
      }
    });
    if (!operation) return res.status(404).json({ error: 'Opération non trouvée' });
    if (req.user.role !== 'ADMIN' && operation.userId !== req.user.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    res.json(operation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mettre à jour le statut (Admin seulement)
router.patch('/:id/status', authenticate, requireAdmin, async (req, res) => {
  const { status, notes } = req.body;
  const validStatuses = ['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'TIMEOUT'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  try {
    const operation = await prisma.operation.update({
      where: { id: req.params.id },
      data: { status, notes },
      include: { user: { select: { id: true, username: true } } }
    });
    await prisma.operationLog.create({
      data: {
        operationId: operation.id,
        message: `Statut mis à jour manuellement: ${status} par ${req.user.username}${notes ? ` — ${notes}` : ''}`,
        level: status === 'FAILED' ? 'ERROR' : 'INFO'
      }
    });
    notifyOperationUpdate(operation);
    res.json(operation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marquer les opérations PROCESSING expirées comme TIMEOUT (job à appeler périodiquement)
router.post('/check-timeouts', authenticate, requireAdmin, async (req, res) => {
  try {
    const configs = await prisma.operatorConfig.findMany();
    let count = 0;
    for (const config of configs) {
      const cutoff = new Date(Date.now() - config.timeoutSeconds * 1000);
      const timedOut = await prisma.operation.updateMany({
        where: {
          operator: config.operator,
          status: 'PROCESSING',
          updatedAt: { lt: cutoff }
        },
        data: { status: 'TIMEOUT', notes: 'Délai de confirmation dépassé' }
      });
      count += timedOut.count;
    }
    res.json({ timedOut: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
