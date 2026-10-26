import { TestBed } from '@angular/core/testing';
import { DownloadService } from './download.service';

describe('DownloadService', () => {
  let created: Blob[];
  let revoked: string[];
  let clicked: { download: string; href: string; parent: Element | null }[];

  beforeEach(() => {
    created = [];
    revoked = [];
    clicked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      created.push(blob as Blob);
      return 'blob:studioflow-test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href, parent: this.parentElement });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('downloads the text under the given name and releases the object URL', async () => {
    TestBed.inject(DownloadService).saveText('StudioFlow-Proxy.json', '{"a":1}');

    expect(clicked).toMatchObject([
      { download: 'StudioFlow-Proxy.json', href: 'blob:studioflow-test', parent: document.body },
    ]);
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/json');
    expect(await created[0]?.text()).toBe('{"a":1}');
    expect(revoked).toEqual(['blob:studioflow-test']);
  });

  it('uses the given file type', () => {
    TestBed.inject(DownloadService).saveText('notes.txt', 'x', { mimeType: 'text/plain' });

    expect(created[0]?.type).toBe('text/plain');
  });

  it('clicks the link inside the given element, so a popover around it stays open', () => {
    const popover = document.createElement('div');
    document.body.append(popover);

    TestBed.inject(DownloadService).saveText('x.json', '{}', { container: popover });

    expect(clicked[0]?.parent).toBe(popover);
    expect(popover.querySelectorAll('a')).toHaveLength(0);
    popover.remove();
  });

  it('leaves no link in the page', () => {
    TestBed.inject(DownloadService).saveText('x.json', '{}');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
