import type { Context } from 'hono';

import { config } from '@/config';
import type { Data, Route } from '@/types';
import { parseDate } from '@/utils/parse-date';
import { withSharedChromePage } from '@/utils/shared-chrome';

export const route: Route = {
    path: '/chrome-test',
    name: 'Chrome Login Test',
    categories: ['other'],
    example: '/localservices/chrome-test',
    maintainers: ['NoneShell'],
    features: {
        requirePuppeteer: true,
        requireConfig: [{ name: 'SHARED_CHROME_CDP_ENDPOINT' }, { name: 'SHARED_CHROME_TEST_URL' }, { name: 'SHARED_CHROME_TEST_PUBLIC_URL' }],
    },
    description: 'Read protected notices from the local Chrome login fixture using the manually authenticated default profile. The fixture is synthetic and must be started separately.',
    handler,
};

function handler(ctx: Context): Promise<Data> {
    ctx.header('Cache-Control', 'no-cache');
    if (!config.sharedChromeTestUrl || !config.sharedChromeTestPublicUrl) {
        throw new Error('Configure SHARED_CHROME_TEST_URL and SHARED_CHROME_TEST_PUBLIC_URL for the local login fixture.');
    }
    const publicUrl = config.sharedChromeTestPublicUrl;
    return withSharedChromePage(
        new URL('/private', config.sharedChromeTestUrl).href,
        async (page) => {
            if (await page.locator('form[action="/login"], a[href="/"]').count()) {
                throw new Error('Log in to the Chrome test site through the shared desktop first (demo / chrome-demo).');
            }
            await page.waitForSelector('body[data-ready="true"] article');
            const profileState = await page.evaluate(() => window.localStorage.getItem('chromeDemoProfile'));
            if (profileState !== 'profile-verified') {
                throw new Error('The shared Chrome profile state is missing.');
            }
            const notices = await page.locator('article').evaluateAll((articles) =>
                articles.map((article) => ({
                    title: article.querySelector('h2')?.textContent || '',
                    path: article.querySelector('a')?.getAttribute('href') || '',
                    description: article.querySelector('.content')?.textContent || '',
                    date: article.querySelector('time')?.getAttribute('datetime') || '',
                }))
            );
            return {
                title: '共享 Chrome 登录态测试',
                link: new URL('/private', publicUrl).href,
                description: '来自本地测试站点的受保护通知，使用共享 Chrome 已登录会话采集。',
                language: 'zh-cn',
                item: notices.map((notice) => ({
                    title: notice.title,
                    link: new URL(notice.path, publicUrl).href,
                    description: notice.description,
                    pubDate: parseDate(notice.date),
                })),
            };
        },
        ['document']
    );
}
