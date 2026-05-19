"use client";

import { useEffect } from 'react';
import { installGlobalClientErrorHandlers } from '@/lib/client-error-reporting';

export default function ClientErrorReporter() {
  useEffect(() => installGlobalClientErrorHandlers(), []);

  return null;
}
