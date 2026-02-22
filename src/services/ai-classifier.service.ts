/**
 * AI 情緒分析服務
 * 使用 GPT-4o-mini 進行情緒分析和主題分類
 */

import OpenAI from 'openai';
import config from '../config';
import logger from '../utils/logger';

export interface AISentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  sentiment_score: number; // -1 to 1
  sentiment_confidence: number; // 0 to 1
  sentiment_keywords: string[];
  primary_topic: string;
}

const SYSTEM_PROMPT = `你是一個繁體中文情緒分析專家。分析以下文章的情感傾向和主題。

回傳嚴格的 JSON 格式：
{
  "sentiment": "positive" | "negative" | "neutral" | "mixed",
  "sentiment_score": <-1 到 1 的數字，-1 為極度負面，1 為極度正面>,
  "sentiment_confidence": <0 到 1 的數字，表示信心度>,
  "sentiment_keywords": [<最多 5 個關鍵情緒詞>],
  "primary_topic": "<主要議題分類：product_review / complaint / praise / question / news / discussion / other>"
}

分析重點：
- 注意上下文語義，不要只看關鍵字
- 區分產品評論、客訴、稱讚、提問、新聞報導等
- sentiment_score 要反映整體情感傾向，不只是個別詞彙
- mixed 用於同時包含正面和負面情感的文章`;

class AIClassifierService {
  private client: OpenAI | null = null;

  private getClient(): OpenAI | null {
    if (!config.ai.openai.apiKey) {
      return null;
    }
    if (!this.client) {
      this.client = new OpenAI({ apiKey: config.ai.openai.apiKey });
    }
    return this.client;
  }

  /**
   * Analyze sentiment for a single piece of content
   */
  async analyze(title: string, content: string): Promise<AISentimentResult | null> {
    const client = this.getClient();
    if (!client) {
      logger.debug('[AIClassifier] OpenAI API key not configured, skipping');
      return null;
    }

    try {
      // Truncate to 500 chars
      const truncatedContent = content.length > 500 ? content.substring(0, 500) + '...' : content;
      const input = `標題：${title}\n內容：${truncatedContent}`;

      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 300,
      });

      const resultText = response.choices[0]?.message?.content;
      if (!resultText) {
        logger.warn('[AIClassifier] Empty response from OpenAI');
        return null;
      }

      const result = JSON.parse(resultText) as AISentimentResult;

      // Validate required fields
      if (!result.sentiment || result.sentiment_score === undefined) {
        logger.warn('[AIClassifier] Invalid response structure:', resultText);
        return null;
      }

      return result;
    } catch (error: any) {
      logger.error('[AIClassifier] Analysis failed:', error.message);
      return null;
    }
  }

  /**
   * Batch analyze multiple items
   */
  async batchAnalyze(
    items: Array<{ id: string; title: string; content: string }>
  ): Promise<Map<string, AISentimentResult>> {
    const results = new Map<string, AISentimentResult>();

    for (const item of items) {
      try {
        const result = await this.analyze(item.title, item.content);
        if (result) {
          results.set(item.id, result);
        }
      } catch (error: any) {
        logger.warn(`[AIClassifier] Batch item ${item.id} failed:`, error.message);
      }
    }

    return results;
  }
}

export default new AIClassifierService();
