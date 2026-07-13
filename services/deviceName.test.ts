import { describe, it, expect } from 'vitest';
import { guessDeviceName } from './deviceName';

describe('guessDeviceName', () => {
  it('detects iPhone', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('iPhone');
  });
  it('detects iPad', () => {
    expect(guessDeviceName('Mozilla/5.0 (iPad; CPU OS 17_0)')).toBe('iPad');
  });
  it('detects Android', () => {
    expect(guessDeviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android');
  });
  it('falls back to Telefon', () => {
    expect(guessDeviceName('Mozilla/5.0 (Windows NT 10.0)')).toBe('Telefon');
  });
});
