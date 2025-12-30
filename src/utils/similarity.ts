/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Find the most similar embeddings from a list
 */
export function findMostSimilar(
  targetEmbedding: number[],
  embeddings: Array<{ post_id: string; embedding: number[]; content?: string }>,
  threshold: number = 0.86
): Array<{ post_id: string; similarity: number; content?: string }> {
  const similarities = embeddings.map((item) => ({
    post_id: item.post_id,
    similarity: cosineSimilarity(targetEmbedding, item.embedding),
    content: item.content,
  }));

  // Filter by threshold and sort by similarity (descending)
  return similarities
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

export default {
  cosineSimilarity,
  findMostSimilar,
};
