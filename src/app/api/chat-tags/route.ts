import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/request-auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const tags = await prisma.tag.findMany({
      where: { userId },
      include: {
        _count: {
          select: { sessions: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(tags);
  } catch (error) {
    console.error('Get chat tags error:', error);
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { name, color } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }

    const tag = await prisma.tag.create({
      data: {
        name: name.trim(),
        color: color || '#10b981',
        userId,
      },
    });

    return NextResponse.json(tag, { status: 201 });
  } catch (error) {
    console.error('Create chat tag error:', error);
    return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
  }
}
