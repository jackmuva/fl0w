import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BROWSER_PROFILES_DIR } from '../../constants';
import { click, closeBrowser, fill, findChromeExecutable, navigate, openBrowser, profileSlug, snapshot } from './browser-session';

describe('profileSlug', () => {
  test('makes Chrome profile names safe folder names', () => {
    expect(profileSlug('Work Profile')).toBe('work-profile');
    expect(profileSlug('ada@example.com')).toBe('ada-example.com');
    expect(profileSlug('..//')).toBe('default');
  });
});

const FORM = `<!doctype html><title>Form</title>
<form action="/submit">
  <label>Name <input name="name"></label>
  <label for="country">Country</label><select id="country" name="country"><option value="us">United States</option><option value="ca">Canada</option></select>
  <label><input type="checkbox" name="terms"> Agree</label>
  <button>Send</button>
</form>`;

describe.skipIf(!findChromeExecutable())('browser automation (requires Chrome)', () => {
  const profile = `test-${crypto.randomUUID().slice(0, 8)}`;
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: (req) => new Response(new URL(req.url).pathname === '/submit' ? `<title>Done</title>${new URL(req.url).search}` : FORM,
        { headers: { 'content-type': 'text/html' } }),
    });
  });

  afterAll(async () => {
    await closeBrowser();
    server.stop(true);
    await rm(join(BROWSER_PROFILES_DIR, profile), { recursive: true, force: true });
  });

  test('fills and submits a form', async () => {
    const opened = await openBrowser({ profile, headless: true, url: server.url.href });
    expect(opened).toContain('input[text] "Name"');

    const filled = await fill([
      { text: 'Name', value: 'Ada' },
      { text: 'Country', value: 'canada' },
      { text: 'Agree', value: true },
      { ref: 99, value: 'x' },
    ]);
    expect(filled).toContain('Filled [0] input[text] "Name" → "Ada"');
    expect(filled).toContain('Selected "Canada"');
    expect(filled).toContain('Checked');
    expect(filled).toContain('Element ref 99 is stale or unknown');

    const after = await click({ text: 'Send' });
    expect(after).toContain('/submit?name=Ada&country=ca&terms=on');

    expect(await navigate({ action: 'back' })).toContain('select "Country"');
    expect(await snapshot()).toContain('Page: Form');
  }, 60_000);
});
