const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Utilisateur inactif ou introuvable' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  }
  next();
};

const authenticateDevice = async (req, res, next) => {
  const token = req.headers['x-device-token'];
  if (!token) return res.status(401).json({ error: 'Token appareil manquant' });
  try {
    const device = await prisma.device.findUnique({ where: { token } });
    if (!device || !device.isActive) {
      return res.status(401).json({ error: 'Appareil non autorisé' });
    }
    await prisma.device.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() }
    });
    req.device = device;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Erreur authentification appareil' });
  }
};

module.exports = { authenticate, requireAdmin, authenticateDevice };
