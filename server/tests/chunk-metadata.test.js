const { chunkText } = require('../src/services/processor');

describe('Chunk Metadata Extraction', () => {
  test('Chunks should preserve headings and content', () => {
    const text = `
MODULE 1: INTRODUCTION

This is the first paragraph.
It goes on and on. We need a lot of text here to make sure it surpasses fifty tokens.
Here is sentence number one. Here is sentence number two. Here is sentence number three.
Here is sentence number four. Here is sentence number five. Here is sentence number six.
Here is sentence number seven. Here is sentence number eight. Here is sentence number nine.
Here is sentence number ten. This should definitely be over 50 tokens when processed by the estimateTokens function.
Some other random text without a heading. And even more text to be absolutely sure.
The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.
The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.
    `.trim();

    const chunks = chunkText(text, 512, 50);
    expect(chunks.length).toBeGreaterThan(0);
    
    const firstChunk = chunks[0];
    expect(firstChunk.heading).toBe('MODULE 1: INTRODUCTION');
    expect(firstChunk.content).toContain('first paragraph');
  });
});
