import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { withSharedChromePage } from './shared-chrome';

const mocks = vi.hoisted(() => ({
    config: { sharedChromeCDPEndpoint: 'http://chrome-bridge:9333/' },
    connect: vi.fn(),
}));

vi.mock('@/config', () => ({ config: mocks.config }));
vi.mock('patchright', () => ({ chromium: { connectOverCDP: mocks.connect } }));

const makeBrowser = () => {
    const page = { setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(), route: vi.fn(), goto: vi.fn(), close: vi.fn() };
    const context = { newPage: vi.fn().mockResolvedValue(page), close: vi.fn() };
    const browser = { contexts: vi.fn().mockReturnValue([context]), newContext: vi.fn(), close: vi.fn() };
    return { page, context, browser };
};

let fixture = makeBrowser();
let collect: typeof withSharedChromePage;

beforeEach(async () => {
    vi.resetModules();
    fixture = makeBrowser();
    mocks.config.sharedChromeCDPEndpoint = 'http://chrome-bridge:9333/';
    mocks.connect.mockReset().mockResolvedValue(fixture.browser);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => ({ webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/profile' }) }));
    collect = (await import('./shared-chrome')).withSharedChromePage;
});

afterEach(() => vi.unstubAllGlobals());

describe('shared desktop Chrome ownership', () => {
    it('reuses the default context and releases only the collection page and connection', async () => {
        const result = await collect('https://example.com/', async (page) => {
            expect(page).toBe(fixture.page);
            return await Promise.resolve('collected');
        });
        expect(result).toBe('collected');
        expect(mocks.connect).toHaveBeenCalledWith('ws://chrome-bridge:9333/devtools/browser/profile', { timeout: 10000 });
        expect(fixture.browser.newContext).not.toHaveBeenCalled();
        expect(fixture.context.close).not.toHaveBeenCalled();
        expect(fixture.page.close).toHaveBeenCalledOnce();
        expect(fixture.browser.close).toHaveBeenCalledOnce();
    });

    it('cleans up after navigation failure and lets the next request proceed', async () => {
        fixture.page.goto.mockRejectedValueOnce(new Error('navigation failed'));
        await expect(collect('https://example.com/', () => Promise.resolve('unused'))).rejects.toThrow('navigation failed');
        expect(fixture.page.close).toHaveBeenCalledOnce();
        expect(fixture.context.close).not.toHaveBeenCalled();
        await expect(collect('https://example.com/', () => Promise.resolve('next'))).resolves.toBe('next');
    });

    it('does not connect while paused and never falls back to an empty context', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        await expect(collect('https://example.com/', () => Promise.resolve('unused'))).rejects.toThrow('paused');
        expect(mocks.connect).not.toHaveBeenCalled();
    });

    it('rejects a missing profile context without creating a replacement', async () => {
        fixture.browser.contexts.mockReturnValue([]);
        await expect(collect('https://example.com/', () => Promise.resolve('unused'))).rejects.toThrow('default profile context');
        expect(fixture.browser.newContext).not.toHaveBeenCalled();
        expect(fixture.browser.close).toHaveBeenCalledOnce();
    });

    it('serializes collection requests until the active handler releases its page', async () => {
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const first = collect('https://example.com/', async () => {
            started.resolve();
            await release.promise;
            return 'first';
        });
        await started.promise;
        const second = collect('https://example.com/', () => Promise.resolve('second'));
        expect(fixture.context.newPage).toHaveBeenCalledOnce();
        release.resolve();
        await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
        expect(fixture.context.newPage).toHaveBeenCalledTimes(2);
    });
});
