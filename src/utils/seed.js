require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Initialisation de la base de données...');

  // Créer l'admin par défaut
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin@2024!', 12);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    create: {
      username: 'admin',
      email: process.env.ADMIN_EMAIL || 'admin@yapson.net',
      password: adminPassword,
      role: 'ADMIN'
    },
    update: {}
  });
  console.log(`✅ Admin créé: ${admin.username}`);

  // Configurer les opérateurs avec des exemples de patterns
  const operators = [
    {
      operator: 'ORANGE',
      name: 'Orange Money',
      ussdDepot: '*144*1*{numero}*{montant}#',
      ussdRetrait: '*144*2*{numero}*{montant}#',
      ussdBalance: '*144#',
      // Exemple de pattern: "Transaction effectuee. Vous avez envoye 5000 FCFA ... ID: 123456"
      smsSuccessDepot: 'transaction effectu[ée]e.*(?:id|identifiant)[:\\s]+(?P<txid>[A-Z0-9]+)',
      smsSuccessRetrait: 'retrait.*confirm[ée].*(?:id|ref)[:\\s]+(?P<txid>[A-Z0-9]+)',
      smsFailurePatterns: 'echec\ninsuffisant\nsolde insuffisant\ntransaction annulee',
      usesNotification: false,
      timeoutSeconds: 120,
      numberPrefixes: '07,05,01'
    },
    {
      operator: 'MTN',
      name: 'MTN Mobile Money',
      ussdDepot: '*133*1*{numero}*{montant}#',
      ussdRetrait: '*133*2*{numero}*{montant}#',
      ussdBalance: '*133#',
      smsSuccessDepot: 'momo.*(?:recu|credit).*(?:txid|id)[:\\s]+(?P<txid>[0-9]+)',
      smsSuccessRetrait: 'momo.*retrait.*(?:id)[:\\s]+(?P<txid>[0-9]+)',
      smsFailurePatterns: 'failed\nechoue\ninsufficient',
      usesNotification: false,
      timeoutSeconds: 120,
      numberPrefixes: '07,06'
    },
    {
      operator: 'MOOV',
      name: 'Moov Money',
      ussdDepot: '*555*1*{numero}*{montant}#',
      ussdRetrait: '*555*2*{numero}*{montant}#',
      ussdBalance: '*555#',
      smsSuccessDepot: 'flooz.*(?:reussi|effectue).*ref[:\\s]+(?P<txid>[A-Z0-9]+)',
      smsSuccessRetrait: 'flooz.*retrait.*ref[:\\s]+(?P<txid>[A-Z0-9]+)',
      smsFailurePatterns: 'echec\ninsuffisant\nannule',
      usesNotification: false,
      timeoutSeconds: 120,
      numberPrefixes: '01'
    },
    {
      operator: 'WAVE',
      name: 'Wave',
      ussdDepot: null,
      ussdRetrait: null,
      ussdBalance: null,
      smsSuccessDepot: null,
      smsSuccessRetrait: null,
      smsFailurePatterns: null,
      // Wave utilise les notifications de l'app Wave
      usesNotification: true,
      notifPackageName: 'com.wave.personal',
      notifSuccessDepot: 'vous avez recu.*(?P<txid>[A-Z0-9]{6,})',
      notifSuccessRetrait: 'retrait.*effectue.*(?P<txid>[A-Z0-9]{6,})',
      timeoutSeconds: 180,
      numberPrefixes: '01'
    }
  ];

  for (const op of operators) {
    await prisma.operatorConfig.upsert({
      where: { operator: op.operator },
      create: op,
      update: op
    });
    console.log(`✅ Opérateur configuré: ${op.name}`);
  }

  console.log('\n🎉 Base de données initialisée avec succès!');
  console.log(`\n📋 Identifiants admin:`);
  console.log(`   Username: admin`);
  console.log(`   Password: ${process.env.ADMIN_PASSWORD || 'Admin@2024!'}`);
  console.log('\n⚠️  IMPORTANT: Changez le mot de passe admin en production!');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
