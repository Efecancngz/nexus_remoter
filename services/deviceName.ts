/** Best-effort human-friendly device label from the user agent. */
export function guessDeviceName(ua: string = navigator.userAgent): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  return 'Telefon';
}
