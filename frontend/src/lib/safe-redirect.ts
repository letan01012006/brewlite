// Only allow a local absolute path, never a scheme or protocol-relative URL.
export function safeRedirect(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/';
  const hasControlCharacter = Array.from(raw).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
  return hasControlCharacter ? '/' : raw;
}
