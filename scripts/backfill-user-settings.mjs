
import { prisma } from '../src/lib/prisma.ts'
import { DEFAULT_SETTINGS } from '../src/lib/settings.ts'

async function main() {
  const users = await prisma.user.findMany({
    where: { settings: null },
    select: { id: true, username: true },
  })
  console.log(`Backfilling ${users.length} users without settings`)
  for (const user of users) {
    await prisma.userSettings.create({
      data: { userId: user.id, ...DEFAULT_SETTINGS },
    })
    console.log(`Created settings for ${user.username}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
