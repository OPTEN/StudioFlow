import { resetLocaleForTests } from '@studioflow/i18n';
import { HOLD_OPTIONS } from './constants';
import { validateItem } from './geometry';
import { LAYOUT_TEMPLATES } from './layout-templates';
import { stateFromSnapshot } from './production-state';
import { healthSummary, incidentPlaceWord, sourceLabel } from './selectors';
import { deviceFixture, incidentFixture, itemFixture, snapshotFixture } from './testing/fixtures';

describe('scene model in German (Switzerland)', () => {
  beforeEach(() => resetLocaleForTests('de-CH'));

  it('names the layout templates and their use', () => {
    expect(LAYOUT_TEMPLATES.map((template) => template.name)).toEqual([
      'Vollbild',
      'Nebeneinander',
      'Bild-in-Bild',
      'Screen + Kamera-Spalte',
      'Eins plus zwei',
      '2 × 2',
      '3 × 3',
      'Auto-Grid',
    ]);
    expect(LAYOUT_TEMPLATES[1]?.description).toBe('Interview, Gespräch');
    expect(LAYOUT_TEMPLATES[7]?.description).toBe('ordnet sich nach aktiven Kameras');
  });

  it('labels the "On failure" options', () => {
    expect(HOLD_OPTIONS.map((option) => option.label)).toEqual([
      'Standbild 3 s, dann abgedunkelt',
      'Standbild 10 s, dann abgedunkelt',
      'Standbild halten',
    ]);
  });

  it('switches template names and hold labels with the locale, without a reload', () => {
    resetLocaleForTests('en');
    expect(LAYOUT_TEMPLATES[0]?.name).toBe('Full screen');
    expect(HOLD_OPTIONS[2]?.label).toBe('Hold freeze frame');
    resetLocaleForTests('de-CH');
    expect(LAYOUT_TEMPLATES[0]?.name).toBe('Vollbild');
    expect(HOLD_OPTIONS[2]?.label).toBe('Standbild halten');
  });

  it('reports validation problems in German with a decimal comma', () => {
    expect(
      validateItem(
        itemFixture('i', 's', {
          x: 4000,
          h: 2200,
          crop: { top: 0.5, right: 0, bottom: 0, left: 0 },
          rotation: 45,
          fit: 'stretch' as 'cover',
          border: { width: 41, color: 'red' },
          onLost: { holdMs: 600_001, fallbackSource: 's' },
        }),
      ),
    ).toEqual([
      'X-Position muss eine ganze Zahl zwischen -3840 und 3840 sein.',
      'Höhe muss eine ganze Zahl zwischen 16 und 2160 sein.',
      'Einpassen muss «Füllen» oder «Ganz zeigen» sein.',
      'Zuschnitt oben muss zwischen 0 und 0,45 liegen.',
      'Die Drehung muss 0, 90, 180 oder 270 Grad sein.',
      'Rahmenbreite muss eine ganze Zahl zwischen 1 und 40 sein.',
      'Die Rahmenfarbe muss eine Hex-Farbe wie #e3b341 sein.',
      'Standbild-Dauer muss zwischen 0 und 600 s liegen (ganze Millisekunden).',
      'Die Ersatzquelle darf nicht die eigene Quelle sein.',
    ]);
    expect(validateItem(itemFixture('', ''))).toEqual([
      'Die Element-ID fehlt.',
      'Das Element hat keine Quelle.',
    ]);
  });

  it('words the places, the missing source and the header chip', () => {
    expect(incidentPlaceWord('program')).toBe('im Program');
    expect(incidentPlaceWord('preview')).toBe('in der Preview');
    expect(incidentPlaceWord('off')).toBe('nicht live');

    const state = stateFromSnapshot(snapshotFixture());
    expect(sourceLabel(state, 'dev_gone/camera')).toBe('Quelle fehlt');
    expect(healthSummary({ ...state, devices: new Map() }).text).toBe('Keine Stationen');
    const one = new Map([['dev_a', deviceFixture('dev_a', 'A')]]);
    expect(healthSummary({ ...state, devices: one }).text).toBe('1 Station ok');
    const three = new Map(['a', 'b', 'c'].map((id) => [id, deviceFixture(id, id)] as const));
    expect(healthSummary({ ...state, devices: three }).text).toBe('Alle 3 Stationen ok');

    const withIncidents = {
      ...state,
      incidents: [
        incidentFixture('inc_1', 'dev_a/camera', 'K1', 'reconnecting'),
        incidentFixture('inc_2', 'dev_b/camera', 'K2', 'lost'),
      ],
    };
    expect(healthSummary(withIncidents).text).toBe('2 Störungen');
    expect(
      healthSummary({ ...withIncidents, incidents: withIncidents.incidents.slice(0, 1) }).text,
    ).toBe('1 Störung');
  });
});
