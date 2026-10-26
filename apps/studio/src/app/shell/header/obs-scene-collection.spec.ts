import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@studioflow/scene-model';
import {
  OBS_FPS,
  obsCanvasSize,
  obsSceneCollection,
  obsSceneCollectionFileName,
} from './obs-scene-collection';

interface ObsSource {
  id: string;
  name: string;
  versioned_id: string;
  mixers: number;
  settings: Record<string, unknown>;
}

interface ObsCollection {
  name: string;
  current_scene: string;
  current_program_scene: string;
  scene_order: { name: string }[];
  sources: ObsSource[];
}

const URL_OF_LINK =
  'https://studioflow.example/o/webinar?k=Zk3-_9aQ0v7y2LdE5hN1bXo8cTg4uJmW6rSsPqAiYwU';

function parse(name = 'Teams camera', url = URL_OF_LINK): ObsCollection {
  return JSON.parse(obsSceneCollection(name, url)) as ObsCollection;
}

function browserSource(collection: ObsCollection): ObsSource {
  const found = collection.sources.find((source) => source.id === 'browser_source');
  expect(found).toBeDefined();
  return found!;
}

describe('obsSceneCollection', () => {
  it('is valid JSON with one scene and one browser source, the way OBS writes them', () => {
    const collection = parse();
    expect(collection.sources.map((source) => source.id)).toEqual(['scene', 'browser_source']);
    expect(collection.sources.map((source) => source.versioned_id)).toEqual([
      'scene',
      'browser_source',
    ]);
    expect(collection.scene_order).toEqual([{ name: 'StudioFlow' }]);
    expect(collection.current_scene).toBe('StudioFlow');
    expect(collection.current_program_scene).toBe('StudioFlow');
    expect(collection.name).toBe('StudioFlow – Teams camera');
  });

  it('gives the scene and the browser source different names (they share one namespace in OBS)', () => {
    const names = parse().sources.map((source) => source.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('puts the browser source into the scene as its one visible item, at the top left corner', () => {
    const collection = parse();
    const scene = collection.sources.find((source) => source.id === 'scene')!;
    const settings = scene.settings as { id_counter: number; items: Record<string, unknown>[] };
    expect(settings.items).toHaveLength(1);
    const [item] = settings.items;
    expect(item?.['name']).toBe(browserSource(collection).name);
    expect(item?.['visible']).toBe(true);
    expect(item?.['locked']).toBe(false);
    expect(item?.['pos']).toEqual({ x: 0, y: 0 });
    expect(item?.['scale']).toEqual({ x: 1, y: 1 });
    expect(settings.id_counter).toBeGreaterThanOrEqual(item?.['id'] as number);
  });

  it('sets the browser source: the link, 1920 x 1080, 30 fps, audio via OBS, no shutdown, no refresh', () => {
    const settings = browserSource(parse()).settings;
    expect(settings['url']).toBe(URL_OF_LINK);
    expect(settings['width']).toBe(1920);
    expect(settings['height']).toBe(1080);
    expect(settings['fps']).toBe(30);
    expect(settings['fps_custom']).toBe(true);
    expect(settings['reroute_audio']).toBe(true);
    expect(settings['shutdown']).toBe(false);
    expect(settings['restart_when_active']).toBe(false);
  });

  it('routes the browser source to every audio track of the mixer', () => {
    expect(browserSource(parse()).mixers).toBe(255);
  });

  it('takes the size from one place, the stage of the scene model', () => {
    expect(obsCanvasSize()).toEqual({ width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
    expect(OBS_FPS).toBe(30);
    const scene = parse().sources[0]!.settings as { items: { scale_ref: unknown }[] };
    expect(scene.items[0]?.scale_ref).toEqual({ x: CANVAS_WIDTH, y: CANVAS_HEIGHT });
  });

  it('keeps the key of the link byte for byte', () => {
    const url = new URL(browserSource(parse()).settings['url'] as string);
    expect(url.searchParams.get('k')).toBe('Zk3-_9aQ0v7y2LdE5hN1bXo8cTg4uJmW6rSsPqAiYwU');
  });

  it('does not alter a URL with query characters, quotes or non-ASCII text', () => {
    const odd = 'https://sf.example:8443/o/we-binar?k=a%2Bb&debug=1&x="y"#frag ü';
    expect(browserSource(parse('Proxy', odd)).settings['url']).toBe(odd);
  });

  it('escapes a link name with quotes, backslashes, line breaks and emoji', () => {
    const name = 'Zoom "Raum 1" \\ C:\\tmp\nzweite Zeile 🎥';
    const text = obsSceneCollection(name, URL_OF_LINK);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect(parse(name).name).toBe(`StudioFlow – ${name}`);
    expect(text).not.toContain('\nzweite Zeile');
  });

  it('is the same text for the same input', () => {
    expect(obsSceneCollection('A', URL_OF_LINK)).toBe(obsSceneCollection('A', URL_OF_LINK));
  });

  it('does not repeat the key anywhere but in the URL', () => {
    const text = obsSceneCollection('Teams camera', URL_OF_LINK);
    expect(text.split('Zk3-_9aQ0v7y2LdE5hN1bXo8cTg4uJmW6rSsPqAiYwU')).toHaveLength(2);
  });
});

describe('obsSceneCollectionFileName', () => {
  it.each([
    ['Teams camera', 'StudioFlow-Teams-camera.json'],
    ['Proxy', 'StudioFlow-Proxy.json'],
    ['../Évil\\name: 1', 'StudioFlow-Evil-name-1.json'],
    ['  Zoom  Raum 1  ', 'StudioFlow-Zoom-Raum-1.json'],
    ['🎥', 'StudioFlow-output.json'],
  ])('turns “%s” into %s', (name, file) => {
    expect(obsSceneCollectionFileName(name)).toBe(file);
  });

  it('never contains a path separator', () => {
    expect(obsSceneCollectionFileName('a/b\\c')).not.toMatch(/[\\/]/);
  });
});
