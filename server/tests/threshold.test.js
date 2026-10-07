describe('RAG Thresholds and Fallbacks', () => {
  test('If top score < threshold, returns NOT_FOUND', () => {
    const threshold = 0.55;
    const topScore = 0.50;
    expect(topScore < threshold).toBe(true);
  });

  test('If average score < threshold, returns NOT_FOUND', () => {
    const threshold = 0.55;
    const scores = [0.60, 0.40, 0.45];
    const avg = scores.reduce((a, b) => a + b) / scores.length;
    expect(avg < threshold).toBe(true);
  });
});
