const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient({
  log: process.env.JENN_DB_LOG === '1' ? ['query', 'warn', 'error'] : ['warn', 'error'],
})

async function disconnect() {
  try { await prisma.$disconnect() } catch {}
}

module.exports = { prisma, disconnect }
