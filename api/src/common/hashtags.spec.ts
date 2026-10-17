import { extractHashtags } from './hashtags.js';

describe('extractHashtags', () => {
  it('finds tags, lowercased and unique', () => {
    expect(extractHashtags('#Postgres and #redis, again #postgres!')).toEqual([
      'postgres',
      'redis',
    ]);
  });

  it('handles other scripts and ignores non-tags', () => {
    expect(extractHashtags('नमस्ते #भारत #日本 email#notatag &#39; #')).toEqual(
      ['भारत', '日本'],
    );
  });
});
