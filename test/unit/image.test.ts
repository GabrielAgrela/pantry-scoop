import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IMAGE_LIMITS, parseDataUrl, parseImageList } from '../../src/domain/image.ts';
import { TINY_JPEG, TINY_JPEG_DATA_URL } from '../fakes/fixtures.ts';

describe('parseDataUrl', () => {
  it('decodes a base64 JPEG data URL', () => {
    assert.deepEqual(parseDataUrl(TINY_JPEG_DATA_URL), TINY_JPEG);
  });

  it('rejects unsupported or malformed input', () => {
    assert.throws(() => parseDataUrl('data:image/gif;base64,R0lG'), /Unsupported image type/);
    assert.throws(() => parseDataUrl('http://example.com/a.jpg'), /not a base64 data URL/);
    assert.throws(() => parseDataUrl(123), /data URL string/);
  });

  it('rejects images over the size limit', () => {
    const big = Buffer.alloc(IMAGE_LIMITS.maxBytesPerImage + 1).toString('base64');
    assert.throws(() => parseDataUrl(`data:image/png;base64,${big}`), /too large/);
  });
});

describe('parseImageList', () => {
  it('requires between 1 and the max number of images', () => {
    assert.throws(() => parseImageList([]), /at least one/);
    assert.throws(() => parseImageList('x'), /at least one/);
    assert.throws(() => parseImageList(Array(IMAGE_LIMITS.maxImages + 1).fill(TINY_JPEG_DATA_URL)), /at most/);
    assert.equal(parseImageList([TINY_JPEG_DATA_URL, TINY_JPEG_DATA_URL]).length, 2);
  });
});
