import { NextRequest } from 'next/server';
import { createChatCompletionResponse } from '@/lib/chat-completion';

export const runtime = 'nodejs';
export const maxDuration = 900;

export async function POST(req: NextRequest) {
  return createChatCompletionResponse(req);
}

