import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()
const password = process.argv[2] || 'PeakUI#Secure2026!'
const hash = await bcrypt.hash(password, 12)
const updated = await prisma.user.update({
  where: { username: 'admin' },
  data: { password: hash, tokenVersion: { increment: 1 } },
})
console.log('updated', updated.id, updated.username)
await prisma.$disconnect()
