import { deflateRawSync } from 'node:zlib';

function encode6bit(value) {
  if (value < 10) {
    return String.fromCharCode(48 + value);
  }

  if (value < 36) {
    return String.fromCharCode(55 + value);
  }

  if (value < 62) {
    return String.fromCharCode(61 + value);
  }

  if (value === 62) {
    return '-';
  }

  if (value === 63) {
    return '_';
  }

  return '?';
}

function append3bytes(byte1, byte2, byte3) {
  const c1 = byte1 >> 2;
  const c2 = ((byte1 & 0x03) << 4) | (byte2 >> 4);
  const c3 = ((byte2 & 0x0f) << 2) | (byte3 >> 6);
  const c4 = byte3 & 0x3f;

  return `${encode6bit(c1 & 0x3f)}${encode6bit(c2 & 0x3f)}${encode6bit(c3 & 0x3f)}${encode6bit(c4 & 0x3f)}`;
}

export function encodePlantUmlText(source = '') {
  const compressed = deflateRawSync(Buffer.from(String(source), 'utf-8'));
  let encoded = '';

  for (let index = 0; index < compressed.length; index += 3) {
    encoded += append3bytes(
      compressed[index] ?? 0,
      compressed[index + 1] ?? 0,
      compressed[index + 2] ?? 0,
    );
  }

  return encoded;
}
