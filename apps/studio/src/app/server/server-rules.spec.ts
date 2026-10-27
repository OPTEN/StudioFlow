import {
  fieldIndex,
  filledLines,
  firstInvalidLine,
  isAgeKey,
  isChallengeDomain,
  isDomain,
  isEmail,
  isMediaAddress,
  isOrigin,
  normalizeDomain,
  providerName,
  textLines,
} from './server-rules';

describe('server rules', () => {
  describe('isMediaAddress', () => {
    it.each(['192.168.1.50', '10.0.0.1', '127.0.0.1', ' 172.16.5.4 ', '223.255.255.255'])(
      'accepts %s',
      (value) => expect(isMediaAddress(value)).toBe(true),
    );

    it.each([
      '',
      'localhost',
      '1.2.3',
      '1.2.3.4.5',
      '256.1.1.1',
      '01.2.3.4',
      '0.1.2.3',
      '224.0.0.1',
      'a.b.c.d',
    ])('refuses "%s"', (value) => expect(isMediaAddress(value)).toBe(false));
  });

  describe('isDomain', () => {
    it('accepts host names and normalises case and a final dot', () => {
      expect(isDomain('studioflow.example.com', true)).toBe(true);
      expect(isDomain('Studio-Flow.Example.COM.', true)).toBe(true);
      expect(normalizeDomain(' Studio.Example.com. ')).toBe('studio.example.com');
    });

    it('needs a dot only for a public name', () => {
      expect(isDomain('localhost', false)).toBe(true);
      expect(isDomain('localhost', true)).toBe(false);
    });

    it.each([
      '',
      'not a host',
      '-bad.example.com',
      'a..b',
      '192.168.1.5',
      'under_score.example.com',
    ])('refuses "%s"', (value) => expect(isDomain(value, false)).toBe(false));

    it('refuses a name longer than 253 characters', () => {
      expect(isDomain(`${'a'.repeat(63)}.`.repeat(4) + 'com', true)).toBe(false);
    });

    it('lets the challenge domain start labels with an underscore', () => {
      expect(isChallengeDomain('_acme-challenge.studioflow.dedyn.io')).toBe(true);
      expect(isChallengeDomain('not valid')).toBe(false);
    });
  });

  it('checks e-mail addresses', () => {
    expect(isEmail('ops@example.ch')).toBe(true);
    expect(isEmail(' ops@example.ch ')).toBe(true);
    expect(isEmail('ops@example')).toBe(false);
    expect(isEmail('ops')).toBe(false);
  });

  describe('origins', () => {
    it.each([
      'https://proxy.example.ch',
      'https://*.example.com',
      'http://host:8080',
      'HTTPS://Proxy.Example.ch/',
    ])('accepts %s', (value) => expect(isOrigin(value)).toBe(true));

    it.each([
      'proxy.example.ch',
      'https://',
      'ftp://host',
      'https://host/path',
      "'self'",
      'https://*',
    ])('refuses %s', (value) => expect(isOrigin(value)).toBe(false));

    it('finds the first bad line, counting empty lines', () => {
      const lines = textLines('https://a.example.ch\n\nnope\r\nalso nope');
      expect(lines).toEqual(['https://a.example.ch', '', 'nope', 'also nope']);
      expect(firstInvalidLine(lines, isOrigin)).toBe(3);
      expect(firstInvalidLine(['https://a.example.ch', ''], isOrigin)).toBeNull();
      expect(filledLines(lines)).toBe(3);
    });
  });

  it('knows a public age key', () => {
    expect(isAgeKey(`age1${'q'.repeat(58)}`)).toBe(true);
    expect(isAgeKey('age1short')).toBe(false);
    expect(isAgeKey(`AGE1${'q'.repeat(58)}`)).toBe(false);
  });

  it('reads the index of a list element from a field name', () => {
    expect(fieldIndex('origins[3]')).toBe(3);
    expect(fieldIndex('origins')).toBeNull();
  });

  it('names the providers, and shows the id of one it does not know', () => {
    expect(providerName('dns-route53')).toBe('Amazon Route 53');
    expect(providerName('dns-desec')).toBe('deSEC');
    expect(providerName('dns-newcomer')).toBe('newcomer');
  });
});
