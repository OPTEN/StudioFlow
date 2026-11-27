import { onThisOrigin } from './this-origin';

describe('onThisOrigin', () => {
  it('moves an invite link to the tunnel address the Regie is open at', () => {
    expect(
      onThisOrigin('https://studioflow.opten.dev:9443/j/abc123', 'https://studioflow.opten.dev'),
    ).toBe('https://studioflow.opten.dev/j/abc123');
  });

  it('moves a link to the direct IP address and port, keeping path and query', () => {
    expect(
      onThisOrigin('https://studioflow.opten.dev/o/webinar?k=secret', 'https://172.25.99.187:9443'),
    ).toBe('https://172.25.99.187:9443/o/webinar?k=secret');
  });

  it('keeps the link when there is no page address or it is no http(s) page', () => {
    expect(onThisOrigin('https://a.example/j/x', '')).toBe('https://a.example/j/x');
    expect(onThisOrigin('https://a.example/j/x', 'null')).toBe('https://a.example/j/x');
    expect(onThisOrigin('https://a.example/j/x', 'file://')).toBe('https://a.example/j/x');
  });

  it('keeps a link that is no absolute http(s) URL', () => {
    expect(onThisOrigin('not a url', 'https://b.example')).toBe('not a url');
    expect(onThisOrigin('mailto:x@example.com', 'https://b.example')).toBe('mailto:x@example.com');
  });
});
