/**
 * Bot Detection Utility
 * Detects search engine crawlers and automated bots
 */

/**
 * List of known bot user agent patterns
 * Covers major search engines and common crawlers
 */
const BOT_PATTERNS = [
  // Search engines
  /googlebot/i,
  /bingbot/i,
  /slurp/i, // Yahoo
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /sogou/i,
  /exabot/i,
  /facebot/i, // Facebook
  /ia_archiver/i, // Alexa

  // SEO tools
  /semrushbot/i,
  /ahrefsbot/i,
  /mj12bot/i,
  /dotbot/i,
  /rogerbot/i,
  /screaming frog/i,

  // Social media
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /slackbot/i,

  // Monitoring & Analytics
  /pingdom/i,
  /uptimerobot/i,
  /newrelic/i,
  /statuscake/i,

  // Generic bot indicators
  /bot[\s_-]/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /headless/i,
  /phantom/i,
  /selenium/i,
  /webdriver/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /node-fetch/i,
];

/**
 * Check if a user agent string belongs to a bot
 * @param userAgent - The user agent string to check
 * @returns true if the user agent appears to be a bot, false otherwise
 */
export function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) {
    return false; // If no user agent, assume not a bot (though suspicious)
  }

  // Check against all bot patterns
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

/**
 * Extract bot name from user agent if it's a known bot
 * @param userAgent - The user agent string
 * @returns The bot name if detected, undefined otherwise
 */
export function getBotName(userAgent: string | undefined): string | undefined {
  if (!userAgent || !isBot(userAgent)) {
    return undefined;
  }

  const lowerUA = userAgent.toLowerCase();

  // Search engines
  if (lowerUA.includes('googlebot')) return 'Googlebot';
  if (lowerUA.includes('bingbot')) return 'Bingbot';
  if (lowerUA.includes('slurp')) return 'Yahoo Slurp';
  if (lowerUA.includes('duckduckbot')) return 'DuckDuckBot';
  if (lowerUA.includes('baiduspider')) return 'Baiduspider';
  if (lowerUA.includes('yandexbot')) return 'YandexBot';
  if (lowerUA.includes('facebot')) return 'Facebot';

  // SEO tools
  if (lowerUA.includes('semrushbot')) return 'SEMrushBot';
  if (lowerUA.includes('ahrefsbot')) return 'AhrefsBot';
  if (lowerUA.includes('mj12bot')) return 'MJ12bot';
  if (lowerUA.includes('rogerbot')) return 'Rogerbot';

  // Social media
  if (lowerUA.includes('twitterbot')) return 'Twitterbot';
  if (lowerUA.includes('linkedinbot')) return 'LinkedInBot';
  if (lowerUA.includes('slackbot')) return 'Slackbot';

  // Generic
  if (lowerUA.includes('bot')) return 'Generic Bot';
  if (lowerUA.includes('crawler')) return 'Generic Crawler';
  if (lowerUA.includes('spider')) return 'Generic Spider';

  return 'Unknown Bot';
}
