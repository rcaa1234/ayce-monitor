/**
 * Classifier Service
 * 文本分類服務 - 使用 Regex 規則進行多標籤分類
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

// 規則檔結構
interface NormalizationConfig {
  lowercase: boolean;
  fullwidth_to_halfwidth: boolean;
  collapse_whitespace: boolean;
  strip_symbols_regex: string;
}

interface Rule {
  id: string;
  name: string;
  pattern: string;
  flags: string;
}

interface Topic {
  priority: number;
  label: string;
  color: string;
  rules: Rule[];
}

interface TopicsConfig {
  version: string;
  normalization: NormalizationConfig;
  global_context_regex: string[];
  exclude_patterns: string[];
  min_content_length: number;
  max_matches_per_rule: number;
  topics: Record<string, Topic>;
  primary_topic_rule: string[];
}

// 分類命中結果
export interface ClassificationHit {
  topic: string;
  rule_id: string;
  rule_name: string;
  matched_text: string;
  start: number;
  end: number;
}

// 分類結果
export interface ClassificationResult {
  topics: string[];
  primary_topic: string;
  hits: ClassificationHit[];
  version: string;
}

class ClassifierService {
  private config: TopicsConfig | null = null;
  private compiledPatterns: Map<string, RegExp> = new Map();
  private compiledExcludePatterns: RegExp[] = [];
  private stripSymbolsRegex: RegExp | null = null;

  constructor() {
    this.loadConfig();
  }

  /**
   * 載入規則配置
   */
  private loadConfig(): void {
    try {
      const configPath = path.join(__dirname, '../config/topics_regex.json');
      const configContent = fs.readFileSync(configPath, 'utf-8');
      this.config = JSON.parse(configContent);

      if (this.config) {
        this.compilePatterns();
        logger.info(`[Classifier] Loaded config version ${this.config.version} with ${Object.keys(this.config.topics).length} topics`);
      }
    } catch (error) {
      logger.error('[Classifier] Failed to load config:', error);
    }
  }

  /**
   * 重新載入規則（用於熱更新）
   */
  reloadConfig(): void {
    this.compiledPatterns.clear();
    this.compiledExcludePatterns = [];
    this.loadConfig();
  }

  /**
   * 預編譯所有正則表達式
   */
  private compilePatterns(): void {
    if (!this.config) return;

    // 編譯 exclude patterns
    for (const pattern of this.config.exclude_patterns) {
      try {
        this.compiledExcludePatterns.push(new RegExp(pattern, 'iu'));
      } catch (error) {
        logger.error(`[Classifier] Invalid exclude pattern: ${pattern}`, error);
      }
    }

    // 編譯 strip symbols regex
    if (this.config.normalization.strip_symbols_regex) {
      try {
        this.stripSymbolsRegex = new RegExp(this.config.normalization.strip_symbols_regex, 'g');
      } catch (error) {
        logger.error(`[Classifier] Invalid strip symbols regex`, error);
      }
    }

    // 編譯 topic rules
    for (const [topicName, topic] of Object.entries(this.config.topics)) {
      for (const rule of topic.rules) {
        try {
          const regex = new RegExp(rule.pattern, rule.flags);
          this.compiledPatterns.set(rule.id, regex);
        } catch (error) {
          logger.error(`[Classifier] Invalid pattern for rule ${rule.id}: ${rule.pattern}`, error);
        }
      }
    }
  }

  /**
   * 全形轉半形
   */
  private fullwidthToHalfwidth(text: string): string {
    return text.replace(/[\uff01-\uff5e]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    }).replace(/\u3000/g, ' '); // 全形空格
  }

  /**
   * 正規化文本
   */
  private normalize(text: string): string {
    if (!this.config) return text;

    let result = text;

    // 全形轉半形
    if (this.config.normalization.fullwidth_to_halfwidth) {
      result = this.fullwidthToHalfwidth(result);
    }

    // 轉小寫
    if (this.config.normalization.lowercase) {
      result = result.toLowerCase();
    }

    // 移除符號
    if (this.stripSymbolsRegex) {
      result = result.replace(this.stripSymbolsRegex, '');
    }

    // 合併空白
    if (this.config.normalization.collapse_whitespace) {
      result = result.replace(/\s+/g, ' ').trim();
    }

    return result;
  }

  /**
   * 檢查是否應該排除
   */
  private shouldExclude(text: string): boolean {
    for (const regex of this.compiledExcludePatterns) {
      if (regex.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 分類文本
   */
  classify(content: string): ClassificationResult {
    const emptyResult: ClassificationResult = {
      topics: [],
      primary_topic: 'other',
      hits: [],
      version: this.config?.version || 'unknown',
    };

    if (!this.config) {
      return emptyResult;
    }

    // 檢查最小長度
    if (content.length < this.config.min_content_length) {
      return emptyResult;
    }

    // 正規化
    const normalizedText = this.normalize(content);

    // 檢查是否應該排除
    if (this.shouldExclude(normalizedText)) {
      return emptyResult;
    }

    const topicsSet = new Set<string>();
    const hits: ClassificationHit[] = [];

    // 遍歷所有 topics 和 rules
    for (const [topicName, topic] of Object.entries(this.config.topics)) {
      for (const rule of topic.rules) {
        const regex = this.compiledPatterns.get(rule.id);
        if (!regex) continue;

        // 找出所有匹配
        let matchCount = 0;
        let match: RegExpExecArray | null;

        // 重置 regex 狀態
        regex.lastIndex = 0;

        while ((match = regex.exec(normalizedText)) !== null) {
          if (matchCount >= this.config.max_matches_per_rule) break;

          topicsSet.add(topicName);

          hits.push({
            topic: topicName,
            rule_id: rule.id,
            rule_name: rule.name,
            matched_text: match[0],
            start: match.index,
            end: match.index + match[0].length,
          });

          matchCount++;

          // 防止無限迴圈（如果 regex 沒有 g flag）
          if (!regex.global) break;
        }
      }
    }

    // 決定 primary_topic
    let primaryTopic = 'other';
    for (const t of this.config.primary_topic_rule) {
      if (topicsSet.has(t)) {
        primaryTopic = t;
        break;
      }
    }

    return {
      topics: Array.from(topicsSet),
      primary_topic: primaryTopic,
      hits,
      version: this.config.version,
    };
  }

  /**
   * 取得 topic 的顯示資訊
   */
  getTopicInfo(topicName: string): { label: string; color: string } | null {
    if (!this.config || !this.config.topics[topicName]) {
      return null;
    }
    const topic = this.config.topics[topicName];
    return {
      label: topic.label,
      color: topic.color,
    };
  }

  /**
   * 取得目前版本
   */
  getVersion(): string {
    return this.config?.version || 'unknown';
  }

  /**
   * 取得所有 topic 的資訊
   */
  getAllTopics(): Record<string, { label: string; color: string; priority: number }> {
    if (!this.config) return {};

    const result: Record<string, { label: string; color: string; priority: number }> = {};
    for (const [name, topic] of Object.entries(this.config.topics)) {
      result[name] = {
        label: topic.label,
        color: topic.color,
        priority: topic.priority,
      };
    }
    return result;
  }

  /**
   * 取得完整設定（供 API 使用）
   */
  getFullConfig(): TopicsConfig | null {
    return this.config;
  }

  /**
   * 儲存設定到檔案
   */
  private saveConfig(): void {
    if (!this.config) return;

    try {
      const configPath = path.join(__dirname, '../config/topics_regex.json');
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('[Classifier] Config saved successfully');
    } catch (error) {
      logger.error('[Classifier] Failed to save config:', error);
      throw error;
    }
  }

  /**
   * 更新排除詞
   */
  updateExcludePatterns(patterns: string[]): void {
    if (!this.config) return;

    this.config.exclude_patterns = patterns;
    this.saveConfig();
    this.reloadConfig();
  }

  /**
   * 新增規則到指定 topic
   */
  addRule(topicName: string, rule: Rule): void {
    if (!this.config || !this.config.topics[topicName]) return;

    this.config.topics[topicName].rules.push(rule);
    this.config.version = this.incrementVersion(this.config.version);
    this.saveConfig();
    this.reloadConfig();
  }

  /**
   * 更新規則
   */
  updateRule(topicName: string, ruleId: string, updates: Partial<Rule>): void {
    if (!this.config || !this.config.topics[topicName]) return;

    const ruleIndex = this.config.topics[topicName].rules.findIndex(r => r.id === ruleId);
    if (ruleIndex === -1) return;

    this.config.topics[topicName].rules[ruleIndex] = {
      ...this.config.topics[topicName].rules[ruleIndex],
      ...updates,
    };
    this.config.version = this.incrementVersion(this.config.version);
    this.saveConfig();
    this.reloadConfig();
  }

  /**
   * 刪除規則
   */
  deleteRule(topicName: string, ruleId: string): void {
    if (!this.config || !this.config.topics[topicName]) return;

    this.config.topics[topicName].rules = this.config.topics[topicName].rules.filter(r => r.id !== ruleId);
    this.config.version = this.incrementVersion(this.config.version);
    this.saveConfig();
    this.reloadConfig();
  }

  /**
   * 遞增版本號
   */
  private incrementVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2] || '0', 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  /**
   * 更新完整設定
   */
  updateFullConfig(newConfig: TopicsConfig): void {
    this.config = newConfig;
    this.saveConfig();
    this.reloadConfig();
  }
}

// 單例
export default new ClassifierService();
