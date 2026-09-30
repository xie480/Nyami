import {createAlbumTheme, interpolateAlbumTheme} from '../../src/utils/albumTheme';

describe('createAlbumTheme', () => {
  it('keeps two cover accents distinct and readable on dark artwork', () => {
    const theme = createAlbumTheme({
      primary: '#242424',
      secondary: '#282828',
      average: '#111318',
    });

    expect(theme.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.secondaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.secondaryAccent).not.toBe(theme.primaryAccent);
    expect(theme.foreground).toBe('#FAF7F0');
  });

  it('uses a dark foreground when the cover remains light after its scrim', () => {
    const theme = createAlbumTheme({
      primary: '#F4D68B',
      secondary: '#F4D68B',
      average: '#FFFFFF',
    });

    expect(theme.foreground).toBe('#17191E');
    expect(theme.playForeground).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.scrimOpacity).toBeLessThanOrEqual(0.3);
  });

  it('returns a usable theme when native palette extraction is unavailable', () => {
    const theme = createAlbumTheme(null, '#74A9D8');

    expect(theme.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.secondaryAccent).not.toBe(theme.primaryAccent);
    expect(theme.scrimOpacity).toBeGreaterThanOrEqual(0.38);
    expect(theme.scrimOpacity).toBeLessThanOrEqual(0.68);
  });

  it('interpolates cover colors while keeping the mid-transition theme valid', () => {
    const from = createAlbumTheme({
      primary: '#285B90',
      secondary: '#D3A849',
      average: '#182436',
    });
    const to = createAlbumTheme({
      primary: '#C94D5E',
      secondary: '#E7B67A',
      average: '#F3DDA7',
    });

    const middle = interpolateAlbumTheme(from, to, 0.5);

    expect(middle.effectiveBackgroundColor).not.toBe(
      from.effectiveBackgroundColor,
    );
    expect(middle.effectiveBackgroundColor).not.toBe(
      to.effectiveBackgroundColor,
    );
    expect(middle.primaryAccent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(middle.secondaryAccent).not.toBe(middle.primaryAccent);
    expect(middle.scrimOpacity).toBeCloseTo(
      (from.scrimOpacity + to.scrimOpacity) / 2,
    );
  });
});
