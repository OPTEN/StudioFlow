import { TestBed } from '@angular/core/testing';
import { QR_QUIET_ZONE, QrCodeComponent, qrMatrix, qrPath } from './qr-code.component';

describe('QR code', () => {
  it('draws one rectangle per horizontal run of dark modules', () => {
    const matrix = [
      [true, true, false, true],
      [false, false, false, false],
      [true, false, true, true],
    ];
    expect(qrPath(matrix)).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM0 2h1v1h-1zM2 2h2v1h-2z');
    expect(qrPath([])).toBe('');
    expect(qrPath([[false, false]])).toBe('');
  });

  it('encodes an invite URL into a square matrix without border', () => {
    const matrix = qrMatrix('https://studioflow.opten.ch/join/i/inv_abcdefghijklmnop');
    expect(matrix.length).toBeGreaterThanOrEqual(21);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
    // Finder pattern in the top-left corner: a dark 7-module border.
    expect(matrix[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(matrix[1][1]).toBe(false);
  });

  it('renders the path dark on white with a 4-module quiet zone', async () => {
    const fixture = TestBed.createComponent(QrCodeComponent);
    fixture.componentRef.setInput('value', 'https://studioflow.opten.ch/join/i/test');
    fixture.componentRef.setInput('label', 'QR-Code zum Koppeln');
    await fixture.whenStable();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    const size = qrMatrix('https://studioflow.opten.ch/join/i/test').length;
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('QR-Code zum Koppeln');
    expect(svg?.getAttribute('viewBox')).toBe(
      `${-QR_QUIET_ZONE} ${-QR_QUIET_ZONE} ${size + 8} ${size + 8}`,
    );
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
    const path = svg?.querySelector('path');
    expect(path?.getAttribute('fill')).toBe('#0d1117');
    expect(path?.getAttribute('d')?.startsWith('M0 0h7')).toBe(true);
  });
});
