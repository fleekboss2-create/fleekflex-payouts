// src/utils/seedAdmin.js
// Run this once to create your admin account:
// node src/utils/seedAdmin.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@fleekflexpayouts.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin123!';
  const username = 'admin';
  const phone = '0700000000';

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log('Admin already exists:', email);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const admin = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { username, email, phone, passwordHash, role: 'ADMIN' },
      });
      await tx.wallet.create({ data: { userId: user.id, balance: 0 } });
      return user;
    });

    console.log('✅ Admin account created!');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('   ⚠️  Change your password after first login!');

  } catch (err) {
    console.error('Failed to create admin:', err);
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin();
