// Everything that leaves the machine for the summarizer goes through here first.
const PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[私钥已隐藏]'],
  [/\b(sk|pk|rk|ghp|gho|ghs|glpat|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, '[密钥已隐藏]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[密钥已隐藏]'],
  [/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, '$1 [已隐藏]'],
  [/((?:api[_-]?key|secret|token|passw(?:or)?d|pwd)["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1[已隐藏]'],
  [/(:\/\/[^/\s:@]+:)[^/\s@]{3,}@/g, '$1[已隐藏]@']
]

export const redact = (text: string): string => PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text)

export const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+$/g, '')
  return t.length <= max ? t : `${t.slice(0, max)}…（共 ${t.length} 字）`
}
