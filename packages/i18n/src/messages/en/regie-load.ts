import type { Namespace } from '../../types';

/**
 * What the pictures cost the computers on their way (issue #12): a sender at its CPU limit, software encoding and
 * decoding per stream in the stations and on the monitoring page, and an output page that cannot keep up.
 */
export const regieLoad = {
  'regie.load.cpuLimit': 'CPU at limit',
  'regie.load.cpuLimitCodes': 'CPU at limit {codes}',
  'regie.load.cpuLimitHint':
    'The computer cannot encode fast enough and lowers the picture quality. Close other programs or share a smaller area.',

  'regie.load.decoding.hardware': 'hardware decoding',
  'regie.load.decoding.software': 'software decoding',

  'regie.load.detail.decoding': 'Decoding here',
  'regie.load.detail.decodingCode': 'Decoding {code} here',
  'regie.load.detail.encoding': 'Encoding',
  'regie.load.detail.encodingCode': 'Encoding {code}',

  'regie.load.encoding.hardware': '{codec} · hardware',
  'regie.load.encoding.software': '{codec} · software encoding',

  'regie.load.output.decodingLabel': 'Decoding',
  'regie.load.output.droppedLabel': 'Dropped frames',
  'regie.load.output.dropping': 'drops frames',
  'regie.load.output.droppingHint':
    'The computer of the output page cannot keep up: {percent} of the frames are dropped. Lower the resolution of the production or use a faster computer.',
  'regie.load.output.inSoftware': '{count} in software',
  'regie.load.output.streams': {
    '=0': 'no stream',
    one: '{count} stream',
    other: '{count} streams',
  },
} as const satisfies Namespace<'regie.load'>;
