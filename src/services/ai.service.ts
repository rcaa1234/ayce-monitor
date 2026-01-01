import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config';
import { EngineType } from '../types';
import logger from '../utils/logger';

export interface GenerateContentOptions {
  engine?: EngineType;
  stylePreset?: string;
  topic?: string;
  keywords?: string[];
  maxTokens?: number;
  systemPrompt?: string;
}

export interface GeneratedContent {
  title?: string;
  text: string;
  engine: EngineType;
}

// Model mapping - 根據官方 API 文件 (2025年12月最新版本)
// OpenAI: https://openai.com/api/pricing/
// Google: https://ai.google.dev/gemini-api/docs/models (2025年12月18日更新)
const MODEL_MAP: Record<string, string> = {
  // OpenAI GPT-5.2 Series (2025年12月11日發布)
  GPT5_2: 'gpt-5.2',                        // Thinking mode - 推理模式
  GPT5_2_INSTANT: 'gpt-5.2-chat-latest',    // Instant mode - 即時回應
  GPT5_2_PRO: 'gpt-5.2-pro',                // Pro mode - 專業版本

  // OpenAI GPT-4o Series (官方確認)
  GPT4O: 'gpt-4o',                          // 旗艦多模態模型
  GPT4O_MINI: 'gpt-4o-mini',                // 經濟快速版本

  // Google Gemini 3 Series (2025最新 - 官方文件確認)
  GEMINI_3_FLASH: 'gemini-3-flash-preview',     // 最新Flash預覽版
  GEMINI_3_PRO_PREVIEW: 'gemini-3-pro-preview', // 最新Pro預覽版

  // Google Gemini 2.5 Series (官方文件確認)
  GEMINI_2_5_PRO: 'gemini-2.5-pro',
  GEMINI_2_5_FLASH: 'gemini-2.5-flash',
  GEMINI_2_5_FLASH_LITE: 'gemini-2.5-flash-lite',

  // Google Gemini 2.0 Series (官方文件確認)
  GEMINI_2_0_FLASH: 'gemini-2.0-flash',
  GEMINI_2_0_FLASH_LITE: 'gemini-2.0-flash-lite',
};

class AIService {
  private openai: OpenAI | null = null;
  private gemini: GoogleGenerativeAI | null = null;

  constructor() {
    // Initialize OpenAI
    if (config.ai.openai.apiKey) {
      this.openai = new OpenAI({
        apiKey: config.ai.openai.apiKey,
      });
    }

    // Initialize Gemini
    if (config.ai.gemini.apiKey) {
      this.gemini = new GoogleGenerativeAI(config.ai.gemini.apiKey);
    }
  }

  /**
   * Main method to generate content using any engine
   */
  async generateContent(options: GenerateContentOptions): Promise<GeneratedContent> {
    const engine = options.engine || EngineType.GPT4O;

    // Determine if it's a GPT or Gemini model
    if (this.isGPTModel(engine)) {
      return await this.generateWithGPT(engine, options);
    } else if (this.isGeminiModel(engine)) {
      return await this.generateWithGemini(engine, options);
    } else {
      throw new Error(`Unsupported engine type: ${engine}`);
    }
  }

  /**
   * Check if model is GPT-based (OpenAI)
   */
  private isGPTModel(engine: EngineType): boolean {
    return engine.startsWith('GPT') || engine.startsWith('O');
  }

  /**
   * Check if model is Gemini-based
   */
  private isGeminiModel(engine: EngineType): boolean {
    return engine.startsWith('GEMINI');
  }

  /**
   * Generate content using GPT models
   */
  private async generateWithGPT(engine: EngineType, options: GenerateContentOptions): Promise<GeneratedContent> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const modelName = MODEL_MAP[engine];
    if (!modelName) {
      throw new Error(`Unknown GPT model: ${engine}`);
    }

    const prompt = this.buildPrompt(options);
    const systemPrompt = options.systemPrompt || 'You are a professional content creator for social media. Create engaging, authentic posts for Threads that match the brand voice and style.';

    try {
      logger.info(`Generating content with ${modelName}`);

      // GPT-5.2 系列使用 max_completion_tokens，其他模型使用 max_tokens
      const isGPT52 = engine.startsWith('GPT5_2');
      const tokenParam = isGPT52
        ? { max_completion_tokens: options.maxTokens || 500 }
        : { max_tokens: options.maxTokens || 500 };

      const response = await this.openai.chat.completions.create({
        model: modelName,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        ...tokenParam,
        temperature: 0.8,
      });

      const content = response.choices[0]?.message?.content || '';

      return {
        text: content,
        engine,
      };
    } catch (error: any) {
      logger.error(`GPT generation failed with ${modelName}:`, error);
      throw new Error(`GPT generation failed: ${error.message}`);
    }
  }

  /**
   * Generate content using Gemini models
   */
  private async generateWithGemini(engine: EngineType, options: GenerateContentOptions): Promise<GeneratedContent> {
    if (!this.gemini) {
      throw new Error('Gemini API key not configured');
    }

    const modelName = MODEL_MAP[engine];
    if (!modelName) {
      throw new Error(`Unknown Gemini model: ${engine}`);
    }

    const prompt = this.buildPrompt(options);
    const systemPrompt = options.systemPrompt || 'You are a professional content creator for social media. Create engaging, authentic posts for Threads that match the brand voice and style.';

    try {
      logger.info(`Generating content with ${modelName}`);

      const model = this.gemini.getGenerativeModel({
        model: modelName,
      });

      // Combine system prompt with user prompt
      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${prompt}`
        : prompt;

      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const content = response.text();

      return {
        text: content,
        engine,
      };
    } catch (error: any) {
      logger.error(`Gemini generation failed with ${modelName}:`, error);
      throw new Error(`Gemini generation failed: ${error.message}`);
    }
  }

  /**
   * Generate embedding vector for similarity comparison
   */
  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await this.openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });

      return response.data[0].embedding;
    } catch (error: any) {
      logger.error('Embedding generation failed:', error);
      throw new Error(`Embedding generation failed: ${error.message}`);
    }
  }

  /**
   * Build prompt from options
   */
  private buildPrompt(options: GenerateContentOptions): string {
    let prompt = '';

    // Use custom style preset if provided
    if (options.stylePreset) {
      prompt = options.stylePreset;
    } else {
      prompt = 'Create an engaging Threads post';

      if (options.topic) {
        prompt += ` about ${options.topic}`;
      }

      if (options.keywords && options.keywords.length > 0) {
        prompt += `. Include these keywords naturally: ${options.keywords.join(', ')}`;
      }

      prompt += '. The post should be engaging, authentic, and suitable for social media. Keep it concise and impactful.';
    }

    return prompt;
  }
}

export default new AIService();
