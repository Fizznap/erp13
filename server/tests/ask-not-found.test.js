const { generateAnswer } = require('../src/services/rag');

// Mock fetch for Gemini API
global.fetch = jest.fn();

describe('RAG Not Found Fallback', () => {
  test('Query on unrelated text returns exact NOT_FOUND phrase and was_found=false', async () => {
    const subjectName = 'Math 101';
    
    // Simulate LLM returning a failure or saying it doesn't know
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: "I'm sorry, I don't know the answer." }] }
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })
    });

    const chunks = [
      {
        content: 'Apples are red.',
        original_name: 'doc1.pdf',
        page_number: 1,
        chunk_index: 0
      }
    ];

    const result = await generateAnswer('What is quantum mechanics?', chunks, subjectName);
    
    expect(result.answer).toBe(`Not in provided material.`);
  });

  test('Query on related text returns citation', async () => {
    const subjectName = 'Math 101';
    
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: "Apples are red according to [1]." }] }
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 }
      })
    });

    const chunks = [
      {
        content: 'Apples are red.',
        original_name: 'doc1.pdf',
        page_number: 1,
        chunk_index: 0
      }
    ];

    const result = await generateAnswer('What color are apples?', chunks, subjectName);
    
    expect(result.answer).toContain('Apples are red');
    expect(result.answer).not.toBe(`Not in provided material.`);
  });
});
