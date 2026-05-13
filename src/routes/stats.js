const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Statistiques globales (Admin)
router.get('/overview', authenticate, requireAdmin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOps, todayOps, successOps, failedOps, pendingOps,
      totalVolume, todayVolume,
      byOperator, byType, recentOps
    ] = await Promise.all([
      prisma.operation.count(),
      prisma.operation.count({ where: { createdAt: { gte: today } } }),
      prisma.operation.count({ where: { status: 'SUCCESS' } }),
      prisma.operation.count({ where: { status: 'FAILED' } }),
      prisma.operation.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.operation.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS' } }),
      prisma.operation.aggregate({ _sum: { amount: true }, where: { status: 'SUCCESS', createdAt: { gte: today } } }),
      prisma.operation.groupBy({
        by: ['operator', 'status'],
        _count: true,
        _sum: { amount: true }
      }),
      prisma.operation.groupBy({
        by: ['type', 'status'],
        _count: true,
        _sum: { amount: true }
      }),
      prisma.operation.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true } } }
      })
    ]);

    res.json({
      totals: { total: totalOps, today: todayOps, success: successOps, failed: failedOps, pending: pendingOps },
      volume: { total: totalVolume._sum.amount || 0, today: todayVolume._sum.amount || 0 },
      byOperator,
      byType,
      recentOperations: recentOps
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Statistiques de l'utilisateur connecté
router.get('/my', authenticate, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const where = { userId: req.user.id };

    const [total, success, failed, pending, volume, todayOps] = await Promise.all([
      prisma.operation.count({ where }),
      prisma.operation.count({ where: { ...where, status: 'SUCCESS' } }),
      prisma.operation.count({ where: { ...where, status: 'FAILED' } }),
      prisma.operation.count({ where: { ...where, status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.operation.aggregate({ _sum: { amount: true }, where: { ...where, status: 'SUCCESS' } }),
      prisma.operation.count({ where: { ...where, createdAt: { gte: today } } })
    ]);

    res.json({
      total, success, failed, pending,
      volumeTotal: volume._sum.amount || 0,
      today: todayOps
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gestion des utilisateurs (Admin)
router.get('/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, email: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', authenticate, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Champs requis manquants' });
  try {
    const hashed = await require('bcryptjs').hash(password, 12);
    const user = await prisma.user.create({
      data: { username, email, password: hashed, role: role || 'USER' },
      select: { id: true, username: true, email: true, role: true, createdAt: true }
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username ou email déjà utilisé' });
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id', authenticate, requireAdmin, async (req, res) => {
  const { isActive, role } = req.body;
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive, role },
      select: { id: true, username: true, email: true, role: true, isActive: true }
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
