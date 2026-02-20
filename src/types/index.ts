// Enums
export enum PostStatus {
  DRAFT = 'DRAFT',
  GENERATING = 'GENERATING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  PUBLISHING = 'PUBLISHING',
  POSTED = 'POSTED',
  FAILED = 'FAILED',
  ACTION_REQUIRED = 'ACTION_REQUIRED',
  SKIPPED = 'SKIPPED'
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED'
}

export enum EngineType {
  // Manual (no AI)
  MANUAL = 'MANUAL',

  // OpenAI GPT-5.2 Series (2025年12月11日發布 - 官方文件確認)
  GPT5_2 = 'GPT5_2',                           // gpt-5.2 - Thinking mode (推理模式)
  GPT5_2_INSTANT = 'GPT5_2_INSTANT',           // gpt-5.2-chat-latest - Instant mode (即時模式)
  GPT5_2_PRO = 'GPT5_2_PRO',                   // gpt-5.2-pro - Pro mode (專業模式)

  // OpenAI GPT-4o Series (官方文件確認)
  GPT4O = 'GPT4O',                             // gpt-4o - 旗艦多模態模型
  GPT4O_MINI = 'GPT4O_MINI',                   // gpt-4o-mini - 快速經濟版本

  // Google Gemini 3 Series (2025最新 - 官方文件確認)
  GEMINI_3_FLASH = 'GEMINI_3_FLASH',               // gemini-3-flash - 最新Flash版本
  GEMINI_3_PRO_PREVIEW = 'GEMINI_3_PRO_PREVIEW',   // gemini-3-pro-preview - 最新Pro預覽

  // Google Gemini 2.5 Series (官方文件確認)
  GEMINI_2_5_PRO = 'GEMINI_2_5_PRO',               // gemini-2.5-pro
  GEMINI_2_5_FLASH = 'GEMINI_2_5_FLASH',           // gemini-2.5-flash
  GEMINI_2_5_FLASH_LITE = 'GEMINI_2_5_FLASH_LITE', // gemini-2.5-flash-lite

  // Google Gemini 2.0 Series (官方文件確認)
  GEMINI_2_0_FLASH = 'GEMINI_2_0_FLASH',           // gemini-2.0-flash-exp
  GEMINI_2_0_FLASH_LITE = 'GEMINI_2_0_FLASH_LITE'  // gemini-2.0-flash-lite
}

export enum ReviewStatus {
  PENDING = 'PENDING',
  USED = 'USED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED'
}

export enum ThreadsAccountStatus {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED'
}

export enum ThreadsAuthStatus {
  OK = 'OK',
  EXPIRED = 'EXPIRED',
  ACTION_REQUIRED = 'ACTION_REQUIRED'
}

export enum JobType {
  GENERATE = 'GENERATE',
  PUBLISH = 'PUBLISH',
  TOKEN_REFRESH = 'TOKEN_REFRESH'
}

export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED'
}

export enum ErrorCode {
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  RATE_LIMIT = 'RATE_LIMIT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// Interfaces
export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  line_user_id?: string;
  google_id?: string;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;
}

export interface Role {
  id: string;
  name: string;
}

export interface Post {
  id: string;
  status: PostStatus;
  created_by: string;
  approved_by?: string;
  approved_at?: Date;
  posted_at?: Date;
  post_url?: string;
  threads_media_id?: string;
  last_error_code?: string;
  last_error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface PostRevision {
  id: string;
  post_id: string;
  revision_no: number;
  title?: string;
  content: string;
  engine_used: EngineType;
  similarity_max: number;
  similarity_hits?: Array<{
    post_id: string;
    similarity: number;
  }>;
  generation_params?: Record<string, any>;
  created_at: Date;
}

export interface ReviewRequest {
  id: string;
  post_id: string;
  revision_id: string;
  token: string;
  reviewer_user_id: string;
  status: ReviewStatus;
  expires_at: Date;
  used_at?: Date;
  created_at: Date;
}

export interface ThreadsAccount {
  id: string;
  username: string;
  status: ThreadsAccountStatus;
  is_default: boolean;
  created_at: Date;
}

export interface ThreadsAuth {
  account_id: string;
  access_token_encrypted: string;
  expires_at: Date;
  last_refreshed_at?: Date;
  status: ThreadsAuthStatus;
  scopes?: string[];
  updated_at: Date;
}

export interface PostEmbedding {
  post_id: string;
  embedding_json: number[];
  created_at: Date;
}

export interface Job {
  id: string;
  type: JobType;
  post_id?: string;
  revision_id?: string;
  account_id?: string;
  status: JobStatus;
  attempts: number;
  result_json?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLog {
  id: string;
  actor_user_id?: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata?: Record<string, any>;
  created_at: Date;
}

// Request/Response Types
export interface GenerateContentParams {
  style_preset?: string;
  topic?: string;
  keywords?: string[];
}

export interface SimilarityResult {
  is_similar: boolean;
  max_similarity: number;
  similar_posts: Array<{
    post_id: string;
    similarity: number;
    content: string;
  }>;
}

// Insights Types
export interface PostInsights {
  id: string;
  post_id: string;
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  shares: number;
  engagement_rate: number;
  fetched_at: Date;
  created_at: Date;
}

export enum PeriodType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly'
}

export interface AccountInsights {
  id: string;
  account_id: string;
  followers_count: number;
  following_count: number;
  posts_count: number;
  period_views: number;
  period_interactions: number;
  period_new_followers: number;
  period_posts: number;
  period_start: Date;
  period_end: Date;
  period_type: PeriodType;
  fetched_at: Date;
  created_at: Date;
}
