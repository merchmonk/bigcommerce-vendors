import sharp from 'sharp';
import { encodeWebpUnderMaxBytes } from '../../../lib/etl/bigcommerceImageStaging';

describe('encodeWebpUnderMaxBytes', () => {
  it('returns webp within the byte budget', async () => {
    const raster = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 200, g: 50, b: 80 } },
    })
      .png()
      .toBuffer();

    const maxBytes = 40_000;
    const out = await encodeWebpUnderMaxBytes(raster, maxBytes);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(maxBytes);
  });

  it('returns null when the image cannot be shrunk enough', async () => {
    const tiny = await sharp({
      create: { width: 16, height: 16, channels: 3, background: 'black' },
    })
      .png()
      .toBuffer();

    const out = await encodeWebpUnderMaxBytes(tiny, 8);
    expect(out).toBeNull();
  });
});
