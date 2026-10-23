import { analyzeLine, analyzeText, containsGerman } from './german.mjs';

/** UI strings taken from `main` before the English switch (apps, packages and scripts). */
const GERMAN_UI = [
  "Gleich geht's los",
  'Bild kommt gleich zurück',
  'Alle 2 Stationen ok',
  'Die Eingabe ist ungültig.',
  'Zu viele Versuche. Bitte später erneut versuchen.',
  'Quelle fehlt',
  'Kein Zugang',
  'Danke fürs Zuschauen',
  'Keine Kamera gefunden.',
  'Freigabe beendet',
  'Standbild halten',
  'Benutzername oder Passwort ist falsch.',
  'Szene löschen',
  'Gerät koppeln',
  'Name des Geräts',
  'Bitte einen Namen eingeben.',
  'Einladungslink erstellt',
  'Sendung gestartet',
  'Layout zurücksetzen',
  'Docks und Layout',
  'Alle Stationen senden',
  'Noch keine Stationen gekoppelt',
  'Der Server ist nicht erreichbar. Bitte WLAN prüfen.',
  'Dieses Gerät ist gesperrt.',
  'Images bauen und Stack neu starten',
];

/** The English texts that replace them, and typical English UI text that must never be flagged. */
const ENGLISH_UI = [
  'Starting soon',
  'Scene “Break” is live',
  'Station K2 reconnecting',
  'Thanks for watching',
  'No access',
  'Picture returns shortly',
  'Source missing',
  'Hold freeze frame',
  'Camera: only 640 × 360 at 15 fps.',
  'The server is not reachable right now. Please try again shortly.',
  'Too many attempts. Please try again later.',
  'Output access changed',
  'Invite link created',
  'Wrong username or password.',
  'Sign in',
  'Settings',
  'Auto grid',
  'Picture in picture',
  'Presentation with two people',
  'Host and two guests',
  'Panel or Q&A',
  'All 3 stations ok',
  '2 incidents',
  'Interface language',
  'Automatic (browser language)',
];

describe('calibration', () => {
  it('flags every one of the 25 German UI strings', () => {
    expect(GERMAN_UI).toHaveLength(25);
    const missed = GERMAN_UI.filter((text) => !containsGerman(text));
    expect(missed).toEqual([]);
  });

  it('passes every one of the 25 English UI strings', () => {
    expect(ENGLISH_UI).toHaveLength(25);
    const flagged = ENGLISH_UI.filter((text) => containsGerman(text));
    expect(flagged).toEqual([]);
  });
});

describe('H1: umlauts and ß', () => {
  it('finds each of them', () => {
    for (const letter of 'äöüÄÖÜß') {
      expect(analyzeLine(`x ${letter} y`).map((hit) => hit.rule)).toContain('H1');
    }
  });

  it('does not mistake typographic symbols for umlauts', () => {
    expect(analyzeLine('1920 × 1080 · 90° ≤ 128 – “quote” ’s …')).toEqual([]);
  });
});

describe('H2: guillemets', () => {
  it('finds « » ‹ ›', () => {
    for (const mark of ['«', '»', '‹', '›']) {
      expect(analyzeLine(`say ${mark}x`).map((hit) => hit.rule)).toContain('H2');
    }
  });
});

describe('H3: function words', () => {
  it('flags one strong word', () => {
    expect(analyzeLine('please und more').map((hit) => hit.rule)).toEqual(['H3']);
    expect(analyzeLine('nicht').map((hit) => hit.detail)).toEqual(['nicht']);
  });

  it('needs two different weak words', () => {
    expect(analyzeLine('mit').map((hit) => hit.rule)).toEqual([]);
    expect(analyzeLine('mit mit mit').map((hit) => hit.rule)).toEqual([]);
    expect(analyzeLine('mit der').map((hit) => hit.rule)).toEqual(['H3']);
  });

  it('leaves out words that are also English', () => {
    expect(analyzeLine('the war was over, die man an am bis falls hat den')).toEqual([]);
  });

  it('matches whole words only', () => {
    expect(analyzeLine('notification nichts underline')).toEqual([]);
  });
});

describe('H4: product vocabulary', () => {
  it('finds nouns and participles, case-sensitive and as whole words', () => {
    expect(analyzeLine('Szene').map((hit) => hit.rule)).toEqual(['H4']);
    expect(analyzeLine('Szenen und').map((hit) => hit.rule)).toContain('H4');
    expect(analyzeLine('verbindet').map((hit) => hit.rule)).toEqual(['H4']);
    expect(analyzeLine('szene')).toEqual([]);
    expect(analyzeLine('Szenenwechsel')).toEqual([]);
  });

  it('does not list Station, Pause, Regie, Dock or Output', () => {
    expect(analyzeLine('Station Pause Regie Dock Output')).toEqual([]);
  });
});

describe('analyzeText', () => {
  it('reports line numbers starting at 1', () => {
    const findings = analyzeText('fine\nBitte warten\nfine again');
    expect(findings.map((finding) => finding.line)).toEqual([2]);
    expect(findings[0]?.text).toBe('Bitte warten');
  });

  it('can be limited to some rules', () => {
    expect(analyzeLine('Gerät und Szene', { rules: ['H1'] }).map((hit) => hit.rule)).toEqual([
      'H1',
    ]);
  });
});
