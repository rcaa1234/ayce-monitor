/**
 * PTT Brain 爬蟲服務
 * 透過 PTT Brain 取得 Dcard 西斯版文章，繞過 Dcard 的防護
 * 使用 Browserless.io 作為無頭瀏覽器服務
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import logger from '../utils/logger';

interface DcardPost {
    postId: string;
    title: string;
    url: string;
    authorName: string | null;
    authorId: string | null;
    excerpt: string | null;
    likesCount: number;
    commentsCount: number;
    publishedAt: Date | null;
}

interface AuthorProfile {
    dcardId: string;
    nickname: string | null;
    bio: string | null;
    twitterId: string | null;
    twitterUrl: string | null;
}

class PttBrainScraperService {
    private browserlessToken: string | null = null;

    constructor() {
        this.browserlessToken = process.env.BROWSERLESS_TOKEN || null;
    }

    /**
     * 取得瀏覽器連接
     */
    private async getBrowser(): Promise<Browser> {
        if (!this.browserlessToken) {
            throw new Error('BROWSERLESS_TOKEN 環境變數未設定');
        }

        // 連接到 Browserless.io
        const browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${this.browserlessToken}`,
        });

        return browser;
    }

    /**
     * 從 PTT Brain 取得 Dcard 西斯版文章列表
     */
    async fetchDcardSexPosts(maxPages: number = 3): Promise<DcardPost[]> {
        logger.info(`[PTTBrain] 開始爬取西斯版，最多 ${maxPages} 頁`);

        let browser: Browser | null = null;
        const posts: DcardPost[] = [];

        try {
            browser = await this.getBrowser();
            const page = await browser.newPage();

            // 設定 User Agent
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // 前往 PTT Brain 的 Dcard 西斯版
            const baseUrl = 'https://www.pttbrain.com/dcard/forum/sex';
            await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // 等待文章列表載入
            await page.waitForSelector('a[href*="/dcard/post/"]', { timeout: 15000 }).catch(() => {
                logger.warn('[PTTBrain] 找不到文章連結，可能頁面結構改變');
            });

            // 爬取多頁
            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                logger.info(`[PTTBrain] 爬取第 ${pageNum} 頁`);

                // 提取當前頁面的文章
                const pagePosts = await this.extractPostsFromPage(page);
                posts.push(...pagePosts);

                logger.info(`[PTTBrain] 第 ${pageNum} 頁找到 ${pagePosts.length} 篇文章`);

                // 如果還有下一頁，點擊下一頁
                if (pageNum < maxPages) {
                    const hasNextPage = await this.goToNextPage(page);
                    if (!hasNextPage) {
                        logger.info('[PTTBrain] 沒有更多頁面');
                        break;
                    }
                    // 等待頁面載入
                    await page.waitForSelector('a[href*="/dcard/post/"]', { timeout: 10000 }).catch(() => {});
                }
            }

            logger.info(`[PTTBrain] 總共取得 ${posts.length} 篇文章`);
            return posts;
        } catch (error) {
            logger.error('[PTTBrain] 爬取失敗:', error);
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * 從頁面提取文章列表
     */
    private async extractPostsFromPage(page: Page): Promise<DcardPost[]> {
        // 在瀏覽器上下文中執行，使用 Function 類型避免 TypeScript 錯誤
        const extractFn = new Function(`
            const posts = [];
            const postLinks = document.querySelectorAll('a[href*="/dcard/post/"]');

            postLinks.forEach(function(link) {
                const href = link.getAttribute('href') || '';
                const postIdMatch = href.match(/\\/dcard\\/post\\/(\\d+)/);
                if (!postIdMatch) return;

                const postId = postIdMatch[1];
                const titleEl = link.querySelector('h2, h3, [class*="title"]') || link;
                const title = (titleEl.textContent || '').trim();

                if (!title || title.length < 3) return;
                if (posts.some(function(p) { return p.postId === postId; })) return;

                posts.push({
                    postId: postId,
                    title: title,
                    url: 'https://www.dcard.tw/f/sex/p/' + postId,
                    authorName: null,
                    authorId: null,
                    excerpt: null,
                    likesCount: 0,
                    commentsCount: 0,
                    publishedAt: null,
                });
            });

            return posts;
        `);

        const result = await page.evaluate(`(${extractFn.toString()})()`);
        return result as DcardPost[];
    }

    /**
     * 點擊下一頁
     */
    private async goToNextPage(page: Page): Promise<boolean> {
        try {
            // 使用 evaluate 來找並點擊下一頁連結
            const clicked = await page.evaluate(`
                (function() {
                    var links = Array.from(document.querySelectorAll('a'));
                    var nextLink = links.find(function(a) {
                        var text = a.textContent || '';
                        return text.includes('⟩') || text.includes('>') || text.includes('下一頁');
                    });
                    if (nextLink) {
                        nextLink.click();
                        return true;
                    }
                    return false;
                })()
            `);

            if (clicked) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                return true;
            }

            return false;
        } catch (error) {
            logger.warn('[PTTBrain] 點擊下一頁失敗:', error);
            return false;
        }
    }

    /**
     * 從 Dcard 文章頁面取得作者資訊
     */
    async fetchAuthorFromPost(postId: string): Promise<AuthorProfile | null> {
        let browser: Browser | null = null;

        try {
            browser = await this.getBrowser();
            const page = await browser.newPage();

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // 使用 PTT Brain 的文章頁面
            const postUrl = `https://www.pttbrain.com/dcard/post/${postId}`;
            await page.goto(postUrl, { waitUntil: 'networkidle2', timeout: 30000 });

            // 等待內容載入
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 提取作者資訊和內容
            const result = await page.evaluate(`
                (function() {
                    var content = document.body.innerText || '';
                    var authorLink = document.querySelector('a[href*="/@"]');
                    var authorId = null;
                    var nickname = null;

                    if (authorLink) {
                        var href = authorLink.getAttribute('href') || '';
                        var match = href.match(/\\/@([^\\/\\?]+)/);
                        if (match) {
                            authorId = match[1];
                        }
                        nickname = (authorLink.textContent || '').trim() || null;
                    }

                    return {
                        authorId: authorId,
                        nickname: nickname,
                        content: content,
                    };
                })()
            `) as { authorId: string | null; nickname: string | null; content: string };

            if (!result.authorId) {
                return null;
            }

            // 檢測 Twitter ID
            const twitterInfo = this.detectTwitterFromContent(result.content);

            return {
                dcardId: result.authorId,
                nickname: result.nickname,
                bio: null,
                twitterId: twitterInfo?.username || null,
                twitterUrl: twitterInfo?.url || null,
            };
        } catch (error) {
            logger.error(`[PTTBrain] 取得文章 ${postId} 作者失敗:`, error);
            return null;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * 從文字內容偵測 Twitter ID
     */
    private detectTwitterFromContent(content: string): { username: string; url: string } | null {
        // Twitter/X 連結模式
        const urlPatterns = [
            /https?:\/\/(www\.)?(twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/|\?|$)/i,
            /(twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/|\?|$)/i,
        ];

        for (const pattern of urlPatterns) {
            const match = content.match(pattern);
            if (match) {
                const username = match[3] || match[2];
                if (username && !this.isReservedTwitterPath(username)) {
                    return {
                        username,
                        url: `https://x.com/${username}`,
                    };
                }
            }
        }

        // @ 開頭的 ID
        const atMentionPattern = /@([a-zA-Z0-9_]{4,15})\b/g;
        const atMatches = content.match(atMentionPattern);
        if (atMatches) {
            for (const match of atMatches) {
                const username = match.substring(1);
                if (!this.isReservedTwitterPath(username)) {
                    return {
                        username,
                        url: `https://x.com/${username}`,
                    };
                }
            }
        }

        // 純 ID 格式（需要關鍵字提示）
        const plainIdPattern = /\b(?:twitter|tw|X|推特|小藍鳥)[：:\s]*@?([a-zA-Z0-9_]{4,15})\b/i;
        const plainMatch = content.match(plainIdPattern);
        if (plainMatch) {
            const username = plainMatch[1];
            if (!this.isReservedTwitterPath(username)) {
                return {
                    username,
                    url: `https://x.com/${username}`,
                };
            }
        }

        return null;
    }

    /**
     * 檢查是否為 Twitter 保留路徑
     */
    private isReservedTwitterPath(path: string): boolean {
        const reserved = [
            'home', 'explore', 'search', 'notifications', 'messages',
            'settings', 'login', 'signup', 'i', 'intent', 'share',
            'hashtag', 'compose', 'lists', 'bookmarks', 'communities',
        ];
        return reserved.includes(path.toLowerCase());
    }

    /**
     * 測試連接
     */
    async testConnection(): Promise<{
        success: boolean;
        browserlessToken: boolean;
        message: string;
        postsFound?: number;
        sampleTitles?: string[];
        debug?: any;
    }> {
        const result: {
            success: boolean;
            browserlessToken: boolean;
            message: string;
            postsFound?: number;
            sampleTitles?: string[];
            debug?: any;
        } = {
            success: false,
            browserlessToken: !!this.browserlessToken,
            message: '',
        };

        if (!this.browserlessToken) {
            result.message = '未設定 BROWSERLESS_TOKEN 環境變數';
            return result;
        }

        let browser: Browser | null = null;

        try {
            browser = await this.getBrowser();
            const page = await browser.newPage();

            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );

            // 測試 PTT Brain
            await page.goto('https://www.pttbrain.com/dcard/forum/sex', {
                waitUntil: 'networkidle0',  // 更嚴格的等待條件
                timeout: 60000,
            });

            // 等待頁面載入（更長的等待時間）
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 嘗試滾動頁面來觸發懶載入
            await page.evaluate(`
                (function() {
                    window.scrollTo(0, document.body.scrollHeight / 2);
                })()
            `);
            await new Promise(resolve => setTimeout(resolve, 2000));

            await page.evaluate(`
                (function() {
                    window.scrollTo(0, document.body.scrollHeight);
                })()
            `);
            await new Promise(resolve => setTimeout(resolve, 3000));

            // 取得頁面資訊用於 debug
            const pageInfo = await page.evaluate(`
                (function() {
                    var allLinks = Array.from(document.querySelectorAll('a'));
                    var dcardLinks = allLinks.filter(function(a) {
                        return (a.href || '').includes('dcard');
                    });
                    return {
                        title: document.title,
                        url: window.location.href,
                        bodyLength: document.body.innerText.length,
                        allLinksCount: allLinks.length,
                        dcardLinksCount: dcardLinks.length,
                        sampleLinks: dcardLinks.slice(0, 5).map(function(a) {
                            return { href: a.href, text: (a.textContent || '').substring(0, 50) };
                        }),
                        hasPostLinks: allLinks.some(function(a) {
                            return (a.href || '').includes('/dcard/post/');
                        }),
                    };
                })()
            `) as any;

            result.debug = pageInfo;

            // 嘗試等待文章連結（可選）
            try {
                await page.waitForSelector('a[href*="/dcard/post/"]', { timeout: 5000 });
            } catch {
                // 忽略超時，繼續嘗試提取
            }

            // 提取文章
            const posts = await this.extractPostsFromPage(page);

            result.success = posts.length > 0;
            result.postsFound = posts.length;
            result.sampleTitles = posts.slice(0, 3).map(p => p.title.substring(0, 40));
            result.message = posts.length > 0
                ? `成功取得 ${posts.length} 篇文章`
                : `頁面載入成功但未找到文章 (頁面標題: ${pageInfo.title})`;

            return result;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.message = `連接失敗: ${errorMessage}`;
            return result;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
}

export default new PttBrainScraperService();
