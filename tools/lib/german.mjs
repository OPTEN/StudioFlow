/**
 * Heuristics that recognise German text. Used by `tools/check-german.mjs` (the definition of done of issue #6) and by
 * the E2E audit, which loads this module to look for German in the rendered English UI.
 *
 * Rules (the ids appear in findings and in the allowlists):
 * - H1  umlaut or ß
 * - H2  guillemets « » ‹ ›
 * - H3  German function words: one STRONG word, or two different WEAK words on the same line
 * - H4  product vocabulary (nouns and participles of the UI), case-sensitive
 */

export const RULES = ['H1', 'H2', 'H3', 'H4'];

const UMLAUT = /[äöüÄÖÜß]/u;
const GUILLEMET = /[«»‹›]/u;

/** One hit is enough. */
export const STRONG_WORDS = new Set(
  (
    'nicht bitte wurde wurden werden wird sind kein keine keinen keinem für über wieder jetzt noch auch nur ' +
    'oder und dass diese dieser dieses diesem einen einer eines zum zur beim vom ohne gerade bereits damit ' +
    'sowie sobald alle gleich geht kommt wieder'
  ).split(' '),
);

/**
 * Two different words on one line are needed. Words that are also English or common identifiers are left out on
 * purpose: die, den, war, was, hat, bis, an, am, man, falls.
 */
export const WEAK_WORDS = new Set(
  'der das dem des ein eine ist haben mit von zu auf aus bei nach um wenn dann hier dort wo wie'.split(
    ' ',
  ),
);

/** UI nouns (singular or plural) the product shows; case-sensitive, whole words. */
const PRODUCT_NOUNS = [
  'Szenen?',
  'Quellen?',
  'Stationen',
  'Geräte?',
  'Sendung',
  'Einladung',
  'Anfrage',
  'Produktionen?',
  'Einstellungen?',
  'Verbindung',
  'Kamera',
  'Bildschirm',
  'Freigabe',
  'Störungen?',
  'Übergang',
  'Blende',
  'Schnitt',
  'Vorschau',
  'Datei',
  'Medien',
  'Abbrechen',
  'Speichern',
  'Löschen',
  'Schliessen',
  'Zurück',
  'Weiter',
  'Anmelden',
  'Abmelden',
  'Passwort',
  'Benutzername',
  'Fehler',
  'Warnung',
  'Hinweis',
  'Koppeln',
  'Standbild',
  'Sprache',
  'Zuschauen',
  'Willkommen',
  'Begrüssung',
  'Präsentation',
  'Moderation',
  'Ereignisse',
  'Meldungen',
  'Eigenschaften',
  'Hintergrund',
  'Rahmen',
  'Zuschnitt',
  'Einpassen',
];

/** Participles and adverbs of status messages; case-sensitive, whole words. */
const PRODUCT_PARTICIPLES = [
  'verbindet',
  'gesperrt',
  'entsperrt',
  'gekoppelt',
  'abgebrochen',
  'hochgeladen',
  'gelöscht',
  'erstellt',
  'gestartet',
  'beendet',
  'geändert',
  'verbunden',
  'getrennt',
  'erneut',
];

const WORD_BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_])';
const WORD_BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])';
const PRODUCT_PATTERN = new RegExp(
  `${WORD_BOUNDARY_BEFORE}(?:${[...PRODUCT_NOUNS, ...PRODUCT_PARTICIPLES].join('|')})${WORD_BOUNDARY_AFTER}`,
  'u',
);

/**
 * Words and phrases the product vocabulary alone misses but that are certainly not English. Kept short and
 * case-sensitive; extend it when the recall run shows UI text that slips through.
 */
const PRODUCT_PHRASES = [
  'Gleich geht',
  'Danke fürs',
  'Bild kommt',
  'Zeitüberschreitung',
  'Unbekannte Plattform',
];
const PHRASE_PATTERN = new RegExp(PRODUCT_PHRASES.join('|'), 'u');

const TOKEN = /\p{L}+/gu;

/**
 * Finds German in one line of text that has already been stripped of what must not be scanned.
 * @param {string} line
 * @param {{ rules?: readonly string[] }} [options] rules to evaluate (default all)
 * @returns {{ rule: string, detail: string }[]}
 */
export function analyzeLine(line, options = {}) {
  const rules = options.rules ?? RULES;
  const hits = [];
  if (rules.includes('H1')) {
    const umlaut = UMLAUT.exec(line);
    if (umlaut) {
      hits.push({ rule: 'H1', detail: umlaut[0] });
    }
  }
  if (rules.includes('H2')) {
    const guillemet = GUILLEMET.exec(line);
    if (guillemet) {
      hits.push({ rule: 'H2', detail: guillemet[0] });
    }
  }
  if (rules.includes('H3')) {
    const words = [...line.matchAll(TOKEN)].map((match) => match[0].toLowerCase());
    const strong = words.find((word) => STRONG_WORDS.has(word));
    if (strong) {
      hits.push({ rule: 'H3', detail: strong });
    } else {
      const weak = [...new Set(words.filter((word) => WEAK_WORDS.has(word)))];
      if (weak.length >= 2) {
        hits.push({ rule: 'H3', detail: weak.join(' + ') });
      }
    }
  }
  if (rules.includes('H4')) {
    const product = PRODUCT_PATTERN.exec(line) ?? PHRASE_PATTERN.exec(line);
    if (product) {
      hits.push({ rule: 'H4', detail: product[0] });
    }
  }
  return hits;
}

/** True when `text` (any number of lines) contains German by any rule; for the E2E audit and quick checks. */
export function containsGerman(text, options = {}) {
  return text.split(/\r?\n/u).some((line) => analyzeLine(line, options).length > 0);
}

/** The findings of a multi-line text: `{ line, column, rule, detail, text }`, lines starting at 1. */
export function analyzeText(text, options = {}) {
  const findings = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    for (const hit of analyzeLine(line, options)) {
      findings.push({ line: index + 1, ...hit, text: line.trim() });
    }
  });
  return findings;
}
