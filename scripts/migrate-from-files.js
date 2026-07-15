#!/usr/bin/env node
// ponytail: one-shot migration from data/users.json + data/configs/*.json into Prisma DB.
// Run once after `prisma migrate dev`. Idempotent: skips existing users/configs.
// Usage: node scripts/migrate-from-files.js

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { prisma } = require('../db')

const USERS_PATH = path.join(__dirname, '..', 'data', 'users.json')
const CONFIGS_DIR = path.join(__dirname, '..', 'data', 'configs')

async function migrate() {
  if (!fs.existsSync(USERS_PATH)) {
    console.log('[migrate] No data/users.json found — nothing to migrate.')
    return
  }

  const usersData = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'))
  let userCount = 0, tokenCount = 0, cfgCount = 0

  for (const [username, user] of Object.entries(usersData.users || {})) {
    const u = await prisma.user.upsert({
      where: { username },
      update: {},
      create: {
        username,
        passwordHash: user.passwordHash,
        createdAt: user.createdAt ? new Date(user.createdAt) : undefined,
      },
    })
    userCount++

    for (const t of (user.tokens || [])) {
      await prisma.token.upsert({
        where: { token: t.token },
        update: {},
        create: {
          userId: u.id,
          source: t.source,
          token: t.token,
          createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
        },
      })
      tokenCount++
    }

    // migrate per-user config
    const cfgPath = path.join(CONFIGS_DIR, `${username}.json`)
    if (fs.existsSync(cfgPath)) {
      const configData = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
      await prisma.userConfig.upsert({
        where: { userId: u.id },
        update: {},
        create: { userId: u.id, data: configData },
      })
      cfgCount++
    }
  }

  console.log(`[migrate] Done: ${userCount} users, ${tokenCount} tokens, ${cfgCount} configs migrated.`)
}

migrate()
  .then(() => prisma.$disconnect())
  .catch(err => {
    console.error('[migrate] FAILED:', err)
    prisma.$disconnect()
    process.exit(1)
  })
