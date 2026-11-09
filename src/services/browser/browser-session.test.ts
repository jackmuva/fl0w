import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { click, closeBrowser, fill, findChromeExecutable, navigate, openBrowser, snapshot } from './browser-session';

const FORM = `<!doctype html><title>Form</title>
<form action="/submit">
  <label>Name <input name="name"></label>
  <label for="country">Country</label><select id="country" name="country"><option value="us">United States</option><option value="ca">Canada</option></select>
  <label><input type="checkbox" name="terms"> Agree</label>
  <button>Send</button>
</form>`;

describe.skipIf(!findChromeExecutable())('browser automation (requires Chrome)', () => {
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
  });

  test('fills and submits a form', async () => {
    const opened = await openBrowser({ headless: true, url: server.url.href });
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
