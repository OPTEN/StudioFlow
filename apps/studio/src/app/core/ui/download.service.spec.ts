import { TestBed } from '@angular/core/testing';
import { DownloadService } from './download.service';

describe('DownloadService', () => {
  let created: Blob[];
  let revoked: string[];
  let clicked: { download: string; href: string }[];

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
      clicked.push({ download: this.download, href: this.href });
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('downloads the text under the given name and releases the object URL', async () => {
    TestBed.inject(DownloadService).saveText('StudioFlow-Proxy.json', '{"a":1}');

    expect(clicked).toEqual([{ download: 'StudioFlow-Proxy.json', href: 'blob:studioflow-test' }]);
    expect(created).toHaveLength(1);
    expect(created[0]?.type).toBe('application/json');
    expect(await created[0]?.text()).toBe('{"a":1}');
    expect(revoked).toEqual(['blob:studioflow-test']);
  });

  it('does not let the click reach the page, so an open popover stays open', () => {
    const reached = vi.fn();
    document.addEventListener('click', reached);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      this.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    TestBed.inject(DownloadService).saveText('x.json', '{}');

    document.removeEventListener('click', reached);
    expect(reached).not.toHaveBeenCalled();
  });

  it('leaves no link in the page', () => {
    TestBed.inject(DownloadService).saveText('x.json', '{}');

    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
