/**
 * Content Analysis Utilities
 * Analyzes post content to extract features like length, hashtags, and media type
 */

export type MediaType = 'NONE' | 'IMAGE' | 'VIDEO' | 'CAROUSEL';

/**
 * Calculate content length (character count)
 */
export function calculateContentLength(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  return text.length;
}

/**
 * Extract hashtags from content
 * Returns an array of hashtags without the # symbol
 */
export function extractHashtags(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Match hashtags: # followed by word characters (letters, numbers, underscores)
  // Supports Unicode characters for international hashtags
  const hashtagRegex = /#([\p{L}\p{N}_]+)/gu;
  const matches = text.matchAll(hashtagRegex);

  const hashtags: string[] = [];
  for (const match of matches) {
    if (match[1]) {
      hashtags.push(match[1]);
    }
  }

  // Return unique hashtags
  return Array.from(new Set(hashtags));
}

/**
 * Count hashtags in content
 */
export function countHashtags(text: string): number {
  return extractHashtags(text).length;
}

/**
 * Detect media type from post data
 * This is a placeholder - actual implementation depends on how media data is stored
 */
export function detectMediaType(post: any): MediaType {
  // If post has media_type field, use it directly
  if (post.media_type) {
    return post.media_type as MediaType;
  }

  // Check for media fields
  if (post.media_url || post.image_url) {
    if (Array.isArray(post.media_url) || Array.isArray(post.image_url)) {
      return 'CAROUSEL';
    }

    // Check file extension or mime type
    const url = post.media_url || post.image_url;
    if (typeof url === 'string') {
      const lowerUrl = url.toLowerCase();
      if (lowerUrl.match(/\.(mp4|mov|avi|wmv|flv|webm)$/)) {
        return 'VIDEO';
      }
      if (lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) {
        return 'IMAGE';
      }
    }

    return 'IMAGE'; // Default to IMAGE if we have media_url but can't determine type
  }

  if (post.video_url) {
    return 'VIDEO';
  }

  return 'NONE';
}

/**
 * Check if post has media
 */
export function hasMedia(post: any): boolean {
  return detectMediaType(post) !== 'NONE';
}

/**
 * Analyze complete post content
 * Returns all content features in one call
 */
export interface ContentAnalysis {
  content_length: number;
  hashtag_count: number;
  hashtags: string[];
  media_type: MediaType;
  has_media: boolean;
}

export function analyzeContent(text: string, post?: any): ContentAnalysis {
  const hashtags = extractHashtags(text);
  const mediaType = post ? detectMediaType(post) : 'NONE';

  return {
    content_length: calculateContentLength(text),
    hashtag_count: hashtags.length,
    hashtags,
    media_type: mediaType,
    has_media: mediaType !== 'NONE',
  };
}
