const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Lister tous les opérateurs
router.get('/', authenticate, async (req, res) => {
  try {
    const operators = await prisma.operatorConfig.findMany({
      orderBy: { operator: 'asc' }
    });
    res.json(operators);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Détail d'un opérateur
router.get('/:operator', authenticate, async (req, res) => {
  try {
    const config = await prisma.operatorConfig.findUnique({
      where: { operator: req.params.operator.toUpperCase() }
    });
    if (!config) return res.status(404).json({ error: 'Opérateur non trouvé' });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Créer ou mettre à jour la config d'un opérateur (Admin seulement)
router.put('/:operator', authenticate, requireAdmin, async (req, res) => {
  const operator = req.params.operator.toUpperCase();
  const validOperators = ['ORANGE', 'MTN', 'MOOV', 'WAVE'];
  if (!validOperators.includes(operator)) {
    return res.status(400).json({ error: 'Opérateur invalide' });
  }
  try {
    const data = {
      name: req.body.name || operator,
      isActive: req.body.isActive ?? true,
      ussdStepsDepot: req.body.ussdStepsDepot ? JSON.stringify(req.body.ussdStepsDepot) : null,
      ussdStepsRetrait: req.body.ussdStepsRetrait ? JSON.stringify(req.body.ussdStepsRetrait) : null,
      ussdStepsBalance: req.body.ussdStepsBalance ? JSON.stringify(req.body.ussdStepsBalance) : null,
      validationCode: req.body.validationCode || null,
      ussdDepot: req.body.ussdDepot || null,
      ussdRetrait: req.body.ussdRetrait || null,
      ussdBalance: req.body.ussdBalance || null,
      smsSuccessDepot: req.body.smsSuccessDepot || null,
      smsSuccessRetrait: req.body.smsSuccessRetrait || null,
      smsFailurePatterns: req.body.smsFailurePatterns || null,
      usesNotification: req.body.usesNotification ?? false,
      notifPackageName: req.body.notifPackageName || null,
      notifSuccessDepot: req.body.notifSuccessDepot || null,
      notifSuccessRetrait: req.body.notifSuccessRetrait || null,
      timeoutSeconds: req.body.timeoutSeconds || 120,
      numberPrefixes: req.body.numberPrefixes || null,
    };
    const config = await prisma.operatorConfig.upsert({
      where: { operator },
      create: { operator, ...data },
      update: data
    });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tester un pattern SMS
router.post('/:operator/test-pattern', authenticate, requireAdmin, async (req, res) => {
  const { pattern, testMessage, operationType } = req.body;
  if (!pattern || !testMessage) {
    return res.status(400).json({ error: 'pattern et testMessage requis' });
  }
  try {
    const regex = new RegExp(pattern.trim(), 'i');
    const match = testMessage.match(regex);
    res.json({
      matches: !!match,
      groups: match?.groups || null,
      captures: match ? match.slice(1) : []
    });
  } catch (err) {
    res.status(400).json({ error: `Pattern invalide: ${err.message}` });
  }
});

module.exports = router;
