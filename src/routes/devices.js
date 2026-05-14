const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// Lister les appareils
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const devices = await prisma.device.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enregistrer un nouvel appareil
router.post('/', authenticate, requireAdmin, async (req, res) => {
  const { name, phoneNumber, deviceId, operators } = req.body;
  if (!name || !deviceId) return res.status(400).json({ error: 'name et deviceId requis' });
  try {
    const token = uuidv4();
    const device = await prisma.device.create({
      data: {
        name, phoneNumber, deviceId, token,
        operators: operators ? JSON.stringify(operators) : null
      }
    });
    res.status(201).json(device);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'deviceId déjà enregistré' });
    res.status(500).json({ error: err.message });
  }
});

// Mettre à jour un appareil (opérateurs, statut, etc.)
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, phoneNumber, isActive, operators } = req.body;
  try {
    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(isActive !== undefined && { isActive }),
        operators: operators !== undefined ? (operators ? JSON.stringify(operators) : null) : undefined
      }
    });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Activer/désactiver un appareil
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const device = await prisma.device.update({
      where: { id: req.params.id },
      data: { isActive: req.body.isActive }
    });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supprimer un appareil
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.device.delete({ where: { id: req.params.id } });
    res.json({ message: 'Appareil supprimé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
