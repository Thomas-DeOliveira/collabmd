function formatPerfValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/u, '');
  }

  if (typeof value === 'string') {
    return /[\s=]/u.test(value) ? JSON.stringify(value) : value;
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }

  return JSON.stringify(value);
}

export function isPerfLoggingEnabled(value = '') {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on';
}

export function logPerfEvent(enabled, scope, fields = {}) {
  if (!enabled) {
    return;
  }

  const formattedFields = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${formatPerfValue(value)}`);
  const suffix = formattedFields.length > 0 ? ` ${formattedFields.join(' ')}` : '';
  console.info(`[perf][${scope}]${suffix}`);
}
