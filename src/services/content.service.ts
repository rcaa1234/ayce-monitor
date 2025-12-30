import aiService, { GenerateContentOptions } from './ai.service';
import { PostModel } from '../models/post.model';
import { EmbeddingModel } from '../models/embedding.model';
import { findMostSimilar } from '../utils/similarity';
import { EngineType, PostStatus } from '../types';
import config from '../config';
import logger from '../utils/logger';

export interface GenerateResult {
  content: string;
  engine: EngineType;
  similarityMax: number;
  similarityHits: Array<{ post_id: string; similarity: number }>;
  revisionId: string;
}

class ContentService {
  /**
   * Generate content with similarity checking and fallback engines
   */
  async generateContent(
    postId: string,
    options: GenerateContentOptions
  ): Promise<GenerateResult> {
    const maxRetries = config.similarity.maxRetries;
    const threshold = config.similarity.threshold;

    // Update post status
    await PostModel.updateStatus(postId, PostStatus.GENERATING);

    // Try with GPT first
    let attempts = 0;
    let result: GenerateResult | null = null;

    while (attempts < maxRetries && !result) {
      attempts++;
      logger.info(`Generation attempt ${attempts} with GPT for post ${postId}`);

      try {
        const generated = await aiService.generateContent(options);
        const similarityCheck = await this.checkSimilarity(generated.text);

        if (similarityCheck.max <= threshold) {
          // Success - similarity is acceptable
          result = {
            content: generated.text,
            engine: generated.engine,
            similarityMax: similarityCheck.max,
            similarityHits: similarityCheck.hits,
            revisionId: '',
          };
        } else {
          logger.warn(
            `Similarity too high (${similarityCheck.max}) on attempt ${attempts}`
          );
        }
      } catch (error) {
        logger.error(`GPT generation failed on attempt ${attempts}:`, error);
      }
    }

    // If GPT failed, fallback to Gemini
    if (!result) {
      logger.info('Switching to Gemini engine');

      try {
        // Use Gemini 2.0 Flash as fallback
        const geminiOptions = {
          ...options,
          engine: EngineType.GEMINI_2_0_FLASH,
        };
        const generated = await aiService.generateContent(geminiOptions);
        const similarityCheck = await this.checkSimilarity(generated.text);

        result = {
          content: generated.text,
          engine: generated.engine,
          similarityMax: similarityCheck.max,
          similarityHits: similarityCheck.hits,
          revisionId: '',
        };

        if (similarityCheck.max > threshold) {
          logger.warn(
            `Gemini content still has high similarity (${similarityCheck.max})`
          );
        }
      } catch (error) {
        logger.error('Gemini 生成也失敗:', error);
        throw new Error('所有內容生成引擎都失敗了');
      }
    }

    // Create revision
    const revision = await PostModel.createRevision({
      post_id: postId,
      content: result.content,
      engine_used: result.engine,
      similarity_max: result.similarityMax,
      similarity_hits: result.similarityHits,
      generation_params: {
        engine: options.engine,
        topic: options.topic,
        keywords: options.keywords,
        maxTokens: options.maxTokens,
        // Note: systemPrompt is excluded as it can be very long
      },
    });

    result.revisionId = revision.id;

    // Generate and save embedding for future comparisons
    const embedding = await aiService.generateEmbedding(result.content);
    await EmbeddingModel.save(postId, embedding);

    // Update post status
    if (result.similarityMax > threshold) {
      await PostModel.updateStatus(postId, PostStatus.ACTION_REQUIRED, {
        last_error_message: `High similarity detected: ${result.similarityMax}`,
      });
    } else {
      await PostModel.updateStatus(postId, PostStatus.PENDING_REVIEW);
    }

    return result;
  }

  /**
   * Check content similarity against recent posts
   */
  async checkSimilarity(content: string): Promise<{
    max: number;
    hits: Array<{ post_id: string; similarity: number }>;
  }> {
    try {
      // Generate embedding for new content
      const embedding = await aiService.generateEmbedding(content);

      // Get recent posted embeddings
      const recentEmbeddings = await EmbeddingModel.getRecentPosted(
        config.similarity.compareCount
      );

      if (recentEmbeddings.length === 0) {
        return { max: 0, hits: [] };
      }

      // Find similar posts
      const similar = findMostSimilar(embedding, recentEmbeddings, 0);

      const max = similar.length > 0 ? similar[0].similarity : 0;
      const hits = similar
        .slice(0, 5)
        .map((s) => ({ post_id: s.post_id, similarity: s.similarity }));

      return { max, hits };
    } catch (error) {
      logger.error('Similarity check failed:', error);
      // If similarity check fails, we'll allow the content but log the error
      return { max: 0, hits: [] };
    }
  }

  /**
   * Regenerate content for a post
   */
  async regenerate(postId: string, options?: GenerateContentOptions): Promise<GenerateResult> {
    logger.info(`Regenerating content for post ${postId}`);

    // Get previous revision to extract options if not provided
    if (!options) {
      const latestRevision = await PostModel.getLatestRevision(postId);
      options = latestRevision?.generation_params || {};
    }

    return await this.generateContent(postId, options);
  }
}

export default new ContentService();
