const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Endpoint one-time pour créer/reset l'admin
router.post('/init', async (req, res) => {
  try {
    const { secret } = req.body;
    if (secret !== process.env.JWT_SECRET) {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const password = process.env.ADMIN_PASSWORD || 'Yapson@Admin2024!';
    const hashed = await bcrypt.hash(password, 12);

    const admin = await prisma.user.upsert({
      where: { username: 'admin' },
      create: {
        username: 'admin',
        email: process.env.ADMIN_EMAIL || 'admin@yapson.net',
        password: hashed,
        role: 'ADMIN'
      },
      update: { password: hashed }
    });

    // Créer les opérateurs si besoin
    const ops = ['ORANGE','MTN','MOOV','WAVE'];
    for (const op of ops) {
      await prisma.operatorConfig.upsert({
        where: { operator: op },
        create: { operator: op, name: op, usesNotification: op === 'WAVE', timeoutSeconds: 120 },
        update: {}
      });
    }

    res.json({ 
      success: true, 
      admin: admin.username,
      password: password,
      message: 'Admin créé/mis à jour avec succès'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
