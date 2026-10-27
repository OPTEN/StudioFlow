import type { SlotTelemetryDto } from '@studioflow/scene-model';
import { codecName, decodingText, encodingView } from './stream-load';

function slot(overrides: Partial<SlotTelemetryDto> = {}): SlotTelemetryDto {
  return {
    slot: 'screen-1',
    state: 'live',
    width: 2560,
    height: 1440,
    fps: 15,
    bitrateKbps: 1900,
    packetLossPct: 0,
    codec: 'h264',
    ...overrides,
  };
}

describe('stream load texts', () => {
  it('names codecs the way people write them', () => {
    expect(codecName('h264')).toBe('H.264');
    expect(codecName('VP9')).toBe('VP9');
    expect(codecName('av1')).toBe('AV1');
    expect(codecName('h265')).toBe('H.265');
    expect(codecName('theora')).toBe('THEORA');
    expect(codecName(null)).toBeNull();
    expect(codecName('')).toBeNull();
    expect(codecName(undefined)).toBeNull();
  });

  it('words the encoder of a slot: hardware, software, unknown, and nothing without a codec', () => {
    expect(encodingView(slot({ hardwareEncoder: true }))).toEqual({
      text: 'H.264 · hardware',
      software: false,
      cpuLimited: false,
    });
    expect(encodingView(slot({ codec: 'vp9', hardwareEncoder: false }))).toEqual({
      text: 'VP9 · software encoding',
      software: true,
      cpuLimited: false,
    });
    // The browser does not tell: only the codec, no claim about the encoder.
    expect(encodingView(slot())).toEqual({ text: 'H.264', software: false, cpuLimited: false });
    expect(encodingView(slot({ codec: null }))).toEqual({
      text: '–',
      software: false,
      cpuLimited: false,
    });
    expect(encodingView(undefined)).toEqual({ text: '–', software: false, cpuLimited: false });
  });

  it('flags only the CPU as the reason for a lowered picture', () => {
    expect(encodingView(slot({ qualityLimitation: 'cpu' })).cpuLimited).toBe(true);
    expect(encodingView(slot({ qualityLimitation: 'bandwidth' })).cpuLimited).toBe(false);
    expect(encodingView(slot({ qualityLimitation: 'other' })).cpuLimited).toBe(false);
    expect(encodingView(slot({ qualityLimitation: null })).cpuLimited).toBe(false);
  });

  it('words the decoder of this Regie, and says nothing where the browser does not tell', () => {
    expect(decodingText({ codec: 'h264', decoder: 'hardware' })).toBe('H.264 · hardware decoding');
    expect(decodingText({ codec: 'vp9', decoder: 'software' })).toBe('VP9 · software decoding');
    expect(decodingText({ decoder: 'software' })).toBe('software decoding');
    expect(decodingText({ codec: 'h264' })).toBeNull();
    expect(decodingText(null)).toBeNull();
  });
});
