export const sanitizeIp = (ip: string): string =>
  ip.replace(/^https?:\/\//, '').replace(/\/$/, '').trim();

export function buildAgentUrl(ip: string, path: string): string {
  const cleanIp = sanitizeIp(ip);
  if (!cleanIp) throw new Error('PC IP adresi ayarlı değil.');
  return `https://${cleanIp}:8080${path}`;
}
