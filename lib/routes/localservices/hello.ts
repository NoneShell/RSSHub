import type { Context } from 'hono';

import type { Data, Route } from '@/types';

export const route: Route = {
    path: '/hello/:name?',
    name: 'Hello',
    categories: ['other'],
    example: '/localservices/hello',
    parameters: { name: 'Greeting recipient, defaults to LocalServices' },
    maintainers: ['NoneShell'],
    description: 'A local example for checking custom route loading and development reloads. No external requests are made.',
    handler,
};

function handler(ctx: Context): Data {
    const name = ctx.req.param('name') || 'LocalServices';

    return {
        title: `Hello, ${name}`,
        link: 'https://rsshub.selfnas.top/',
        description: 'LocalServices 自定义路由示例',
        language: 'zh-cn',
        item: [
            {
                title: '自定义路由已加载',
                link: 'https://rsshub.selfnas.top/',
                description: '直接编辑 source/lib/routes/localservices/hello.ts，开发环境会自动重载。',
            },
        ],
    };
}
