/** Tag helpers: `test('E2E-AUTH-01 ...', t.p0.smoke, async () => ...)`. Tags follow docs/testing.md 6.3. */
const make = (...tags: string[]) => ({ tag: tags });

export const t = {
  p0: make('@p0'),
  p1: make('@p1'),
  p2: make('@p2'),
  smoke: make('@p0', '@smoke'),
  disruptive: (priority: '@p0' | '@p1' | '@p2' = '@p1') => make(priority, '@disruptive'),
  shortTtl: (priority: '@p0' | '@p1' | '@p2' = '@p1') => make(priority, '@short-ttl'),
  perf: (priority: '@p0' | '@p1' | '@p2' = '@p1') => make(priority, '@perf'),
  /** Extra tags on top of a priority: `t.with('@p1', '@bug')`. */
  with: (...tags: string[]) => make(...tags),
};
