const fs = require('node:fs');

const DEFAULT_BRANDING = { primaryColor: '#0b1f3a', accentColor: '#d9603b', logoUrl: null };

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateHours(hours) {
  if (!isPlainObject(hours)) return null;
  const display = typeof hours.display === 'string' ? hours.display : null;
  const timezone = typeof hours.timezone === 'string' ? hours.timezone : 'UTC';
  const schedule = isPlainObject(hours.schedule) ? hours.schedule : null;
  if (!display && !schedule) return null;
  return { display, timezone, schedule };
}

function validateBranding(branding) {
  if (!isPlainObject(branding)) return { ...DEFAULT_BRANDING };
  return {
    primaryColor: typeof branding.primaryColor === 'string' ? branding.primaryColor : DEFAULT_BRANDING.primaryColor,
    accentColor: typeof branding.accentColor === 'string' ? branding.accentColor : DEFAULT_BRANDING.accentColor,
    logoUrl: typeof branding.logoUrl === 'string' ? branding.logoUrl : null
  };
}

function validateOwner(owner) {
  if (!isPlainObject(owner)) return { notificationEmail: null, notificationPhone: null };
  return {
    notificationEmail: typeof owner.notificationEmail === 'string' ? owner.notificationEmail : null,
    notificationPhone: typeof owner.notificationPhone === 'string' ? owner.notificationPhone : null
  };
}

function safeDefaultConfig() {
  return {
    businessName: 'Our Company',
    hours: null,
    serviceArea: null,
    pricing: null,
    services: [],
    branding: { ...DEFAULT_BRANDING },
    owner: { notificationEmail: null, notificationPhone: null }
  };
}

function loadConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.warn(`[config-loader] could not read config file at ${filePath}: ${err.message}. Using safe defaults.`);
    return safeDefaultConfig();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[config-loader] config file at ${filePath} is not valid JSON: ${err.message}. Using safe defaults.`);
    return safeDefaultConfig();
  }

  if (!isPlainObject(parsed)) {
    console.warn(`[config-loader] config file at ${filePath} did not contain a JSON object. Using safe defaults.`);
    return safeDefaultConfig();
  }

  if (typeof parsed.businessName !== 'string' || !parsed.businessName.trim()) {
    console.warn('[config-loader] businessName missing or invalid; defaulting to "Our Company".');
  }

  return {
    businessName: typeof parsed.businessName === 'string' && parsed.businessName.trim() ? parsed.businessName : 'Our Company',
    hours: validateHours(parsed.hours),
    serviceArea: typeof parsed.serviceArea === 'string' ? parsed.serviceArea : null,
    pricing: typeof parsed.pricing === 'string' ? parsed.pricing : null,
    services: Array.isArray(parsed.services) ? parsed.services.filter((s) => typeof s === 'string') : [],
    branding: validateBranding(parsed.branding),
    owner: validateOwner(parsed.owner)
  };
}

module.exports = { loadConfig };
