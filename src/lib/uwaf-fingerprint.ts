import { createHash } from 'node:crypto'

export type StealthProfile = 'normal' | 'high'

interface FingerprintSeed {
  id: string
  userAgent: string
  platform: string
  vendor: string
  locale: string
  languages: string[]
  timezoneId: string
  viewport: { width: number; height: number }
  screen: { width: number; height: number }
  deviceScaleFactor: number
  hardwareConcurrency: number
  deviceMemory: number
  maxTouchPoints: number
  colorScheme: 'light' | 'dark'
  reducedMotion: 'no-preference' | 'reduce'
  webglVendor: string
  webglRenderer: string
  connection: {
    downlink: number
    effectiveType: '4g' | '3g'
    rtt: number
    saveData: boolean
  }
}

export interface StealthFingerprint extends FingerprintSeed {
  profile: StealthProfile
  userAgentData: {
    brands: Array<{ brand: string; version: string }>
    mobile: false
    platform: string
    platformVersion: string
    architecture: string
    bitness: '64'
    model: ''
    wow64: boolean
  }
}

export interface StealthProfileDefinition {
  id: StealthProfile
  label: string
  description: string
  fingerprintBias: 'balanced' | 'common'
  providerIds: string[]
  launchArgs: string[]
}

const STEALTH_PROFILE_DEFINITIONS: Record<StealthProfile, StealthProfileDefinition> = {
  normal: {
    id: 'normal',
    label: 'Normal stealth',
    description: 'Balanced stealth profile with broader desktop diversity and lower compatibility risk.',
    fingerprintBias: 'balanced',
    providerIds: ['ahmia', 'duckduckgo-lite', 'startpage', 'brave-search-stealth'],
    launchArgs: [
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-renderer-backgrounding',
      '--metrics-recording-only',
    ],
  },
  high: {
    id: 'high',
    label: 'High stealth',
    description: 'More conservative desktop fingerprints and stricter browser/network behavior for higher-friction targets.',
    fingerprintBias: 'common',
    providerIds: ['duckduckgo-lite', 'ahmia', 'startpage'],
    launchArgs: [
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-features=AutofillServerCommunication,CertificateTransparencyComponentUpdater,OptimizationHints,MediaRouter,Translate,UserAgentClientHint',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-renderer-backgrounding',
      '--metrics-recording-only',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain',
    ],
  },
}

const FINGERPRINT_SEEDS: readonly FingerprintSeed[] = [
  {
    id: 'win11-chrome-148-a',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezoneId: 'America/New_York',
    viewport: { width: 1536, height: 864 },
    screen: { width: 1536, height: 864 },
    deviceScaleFactor: 1.25,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Intel Inc.',
    webglRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false },
  },
  {
    id: 'win11-chrome-148-b',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    locale: 'en-GB',
    languages: ['en-GB', 'en-US', 'en'],
    timezoneId: 'Europe/London',
    viewport: { width: 1440, height: 900 },
    screen: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hardwareConcurrency: 16,
    deviceMemory: 16,
    maxTouchPoints: 0,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    webglVendor: 'NVIDIA Corporation',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 40, saveData: false },
  },
  {
    id: 'win10-chrome-147-a',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7734.54 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezoneId: 'America/Chicago',
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Google Inc. (NVIDIA)',
    webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 55, saveData: false },
  },
  {
    id: 'macos-chrome-148-a',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezoneId: 'America/Los_Angeles',
    viewport: { width: 1512, height: 982 },
    screen: { width: 1512, height: 982 },
    deviceScaleFactor: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M1',
    connection: { downlink: 10, effectiveType: '4g', rtt: 45, saveData: false },
  },
  {
    id: 'macos-chrome-148-b',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    locale: 'fr-FR',
    languages: ['fr-FR', 'fr', 'en-US', 'en'],
    timezoneId: 'Europe/Paris',
    viewport: { width: 1440, height: 900 },
    screen: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M2',
    connection: { downlink: 10, effectiveType: '4g', rtt: 45, saveData: false },
  },
  {
    id: 'linux-chrome-148-a',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezoneId: 'UTC',
    viewport: { width: 1600, height: 900 },
    screen: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    webglVendor: 'Mesa/X.org',
    webglRenderer: 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 60, saveData: false },
  },
  {
    id: 'linux-chrome-147-b',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7734.54 Safari/537.36',
    platform: 'Linux x86_64',
    vendor: 'Google Inc.',
    locale: 'de-DE',
    languages: ['de-DE', 'de', 'en-US', 'en'],
    timezoneId: 'Europe/Berlin',
    viewport: { width: 1536, height: 864 },
    screen: { width: 1536, height: 864 },
    deviceScaleFactor: 1,
    hardwareConcurrency: 12,
    deviceMemory: 16,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 770 (ADL-S GT1) OpenGL)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 55, saveData: false },
  },
  {
    id: 'win11-chrome-148-c',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    locale: 'es-ES',
    languages: ['es-ES', 'es', 'en-US', 'en'],
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1920, height: 1080 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Google Inc. (AMD)',
    webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 48, saveData: false },
  },
  {
    id: 'win11-chrome-148-d',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.7778.167 Safari/537.36',
    platform: 'Win32',
    vendor: 'Google Inc.',
    locale: 'en-CA',
    languages: ['en-CA', 'en-US', 'en'],
    timezoneId: 'America/Toronto',
    viewport: { width: 1728, height: 1117 },
    screen: { width: 1728, height: 1117 },
    deviceScaleFactor: 1.25,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    webglVendor: 'Intel Inc.',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    connection: { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false },
  },
  {
    id: 'macos-chrome-147-c',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.7734.54 Safari/537.36',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    locale: 'en-AU',
    languages: ['en-AU', 'en-GB', 'en-US', 'en'],
    timezoneId: 'Australia/Sydney',
    viewport: { width: 1680, height: 1050 },
    screen: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    webglVendor: 'Apple Inc.',
    webglRenderer: 'Apple M3',
    connection: { downlink: 10, effectiveType: '4g', rtt: 44, saveData: false },
  },
]

const COMMON_FINGERPRINT_IDS = new Set([
  'win11-chrome-148-a',
  'win11-chrome-148-b',
  'win10-chrome-147-a',
  'macos-chrome-148-a',
  'linux-chrome-148-a',
])

export function getStealthProfileDefinition(profile: StealthProfile): StealthProfileDefinition {
  return STEALTH_PROFILE_DEFINITIONS[profile]
}

export function listStealthProfileDefinitions(): StealthProfileDefinition[] {
  return Object.values(STEALTH_PROFILE_DEFINITIONS)
}

export function normalizeStealthProfile(value: unknown): StealthProfile {
  return value === 'high' ? 'high' : 'normal'
}

export function getDefaultStealthProfile(): StealthProfile {
  return normalizeStealthProfile(process.env.UWAF_STEALTH_PROFILE_DEFAULT)
}

function hashToIndex(seed: string, modulo: number): number {
  const digest = createHash('sha256').update(seed).digest()
  return digest.readUInt32BE(0) % Math.max(1, modulo)
}

function buildUserAgentData(seed: FingerprintSeed): StealthFingerprint['userAgentData'] {
  const versionMatch = seed.userAgent.match(/Chrome\/(\d+)\./)
  const major = versionMatch?.[1] || '148'
  return {
    brands: [
      { brand: 'Chromium', version: major },
      { brand: 'Google Chrome', version: major },
      { brand: 'Not=A?Brand', version: '24' },
    ],
    mobile: false,
    platform: seed.platform === 'MacIntel' ? 'macOS' : seed.platform === 'Win32' ? 'Windows' : 'Linux',
    platformVersion: seed.platform === 'MacIntel' ? '15.7.0' : seed.platform === 'Win32' ? '15.0.0' : '6.8.0',
    architecture: 'x86',
    bitness: '64',
    model: '',
    wow64: false,
  }
}

export function buildStealthFingerprint(profile: StealthProfile, seedKey: string): StealthFingerprint {
  const definition = getStealthProfileDefinition(profile)
  const availableSeeds = definition.fingerprintBias === 'common'
    ? FINGERPRINT_SEEDS.filter(seed => COMMON_FINGERPRINT_IDS.has(seed.id))
    : [...FINGERPRINT_SEEDS]
  const seed = availableSeeds[hashToIndex(`${profile}:${seedKey}`, availableSeeds.length)]
  return {
    ...seed,
    profile,
    userAgentData: buildUserAgentData(seed),
  }
}
