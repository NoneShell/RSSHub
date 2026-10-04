import type { Browser, Page } from 'patchright';
import { chromium } from 'patchright';

import { config } from '@/config';

let previousRequest: Promise<void> = Promise.resolve();

type ChromeDiscovery = {
    webSocketDebuggerUrl?: string;
};

async function connectSharedChrome(): Promise<Browser> {
    if (!config.sharedChromeCDPEndpoint) {
        throw new Error('Configure SHARED_CHROME_CDP_ENDPOINT to connect custom routes to the shared Chrome.');
    }

    const endpoint = new URL(config.sharedChromeCDPEndpoint);
    const discoveryUrl = new URL('json/version', endpoint.href.endsWith('/') ? endpoint : `${endpoint.href}/`);
    const response = await fetch(discoveryUrl, { signal: AbortSignal.timeout(10000) });
    if (response.status === 503) {
        throw new Error('Shared Chrome is paused for manual use or is temporarily unavailable.');
    }
    if (!response.ok) {
        throw new Error(`Shared Chrome discovery failed with HTTP ${response.status}.`);
    }
    const discovery = (await response.json()) as ChromeDiscovery;
    if (!discovery.webSocketDebuggerUrl) {
        throw new Error('Shared Chrome did not provide a browser WebSocket endpoint.');
    }

    const websocket = new URL(discovery.webSocketDebuggerUrl);
    // Chrome advertises its loopback address; connect through the configured bridge instead.
    websocket.host = endpoint.host;
    websocket.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    return chromium.connectOverCDP(websocket.href, { timeout: 10000 });
}

async function collect<T>(url: string, handler: (page: Page) => Promise<T>, allowedResourceTypes: readonly string[]): Promise<T> {
    const browser = await connectSharedChrome();
    let page: Page | undefined;
    try {
        const context = browser.contexts()[0];
        if (!context) {
            throw new Error('Shared Chrome has no default profile context. Keep its desktop browser running.');
        }
        page = await context.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
        await page.route('**/*', (route) => (allowedResourceTypes.includes(route.request().resourceType()) ? route.continue() : route.abort()));
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        return await handler(page);
    } finally {
        try {
            await page?.close();
        } finally {
            // connectOverCDP clients detach on close; do not close the shared context or human tabs.
            await browser.close();
        }
    }
}

export async function withSharedChromePage<T>(url: string, handler: (page: Page) => Promise<T>, allowedResourceTypes: readonly string[] = ['document', 'script', 'xhr', 'fetch']): Promise<T> {
    const predecessor = previousRequest;
    const { promise, resolve } = Promise.withResolvers<void>();
    previousRequest = promise;
    await predecessor;
    try {
        return await collect(url, handler, allowedResourceTypes);
    } finally {
        resolve();
    }
}
