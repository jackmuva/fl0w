import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserSession, renderAxTree } from './browser-session';

describe('renderAxTree', () => {
  const nodes = [
    { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Page' }, childIds: ['2', '3', '5'] },
    { nodeId: '2', role: { value: 'heading' }, name: { value: 'Sign up' }, properties: [{ name: 'level', value: { value: 1 } }], childIds: [], backendDOMNodeId: 10 },
    { nodeId: '3', role: { value: 'generic' }, childIds: ['4'] },
    { nodeId: '4', role: { value: 'textbox' }, name: { value: 'Email' }, value: { value: 'a@b.co' }, childIds: [], backendDOMNodeId: 12 },
    { nodeId: '5', role: { value: 'link' }, name: { value: 'Help' }, childIds: ['6'], backendDOMNodeId: 14 },
    { nodeId: '6', role: { value: 'StaticText' }, name: { value: 'Help' }, childIds: [] },
  ];

  test('renders roles, values, states, and refs while skipping generic wrappers and duplicate text', () => {
    expect(renderAxTree(nodes, false)).toEqual([
      '- heading "Sign up" [level=1]',
      '- textbox "Email" value="a@b.co" [ref=e12]',
      '- link "Help" [ref=e14]',
    ]);
  });

  test('interactive mode keeps headings and controls only', () => {
    expect(renderAxTree([...nodes, { nodeId: '7', role: { value: 'paragraph' }, name: { value: 'Intro' }, childIds: [] }], true))
      .toEqual(['- heading "Sign up" [level=1]', '- textbox "Email" value="a@b.co" [ref=e12]', '- link "Help" [ref=e14]']);
  });
});

const CHROME = ['google-chrome', 'chromium', 'chromium-browser'].map((name) => Bun.which(name)).find(Boolean);

const FORM_PAGE = `<!doctype html><html><head><title>Signup</title></head><body>
<h1>Create account</h1>
<form id="form" onsubmit="event.preventDefault(); document.getElementById('out').textContent = JSON.stringify(Object.fromEntries(new FormData(this)));">
  <label>Name <input name="name" value="old"></label>
  <label>Plan <select name="plan"><option value="free">Free</option><option value="pro">Pro</option></select></label>
  <label><input type="checkbox" name="terms"> Accept terms</label>
  <button type="submit">Submit</button>
</form>
<a href="/second" target="_blank">Open docs</a>
<pre id="out"></pre>
<script>console.log('ready')</script>
</body></html>`;

describe.skipIf(!CHROME)('browserSession against headless Chrome', () => {
  let chrome: ReturnType<typeof Bun.spawn>;
  let server: ReturnType<typeof Bun.serve>;
  let profile: string;
  let origin: string;

  const refFor = (snapshot: string, pattern: RegExp) => {
    const line = snapshot.split('\n').find((entry) => pattern.test(entry));
    const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
    if (!ref) throw new Error(`No ref matching ${pattern} in:\n${snapshot}`);
    return ref;
  };

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => new Response(
        new URL(request.url).pathname === '/second' ? '<title>Docs</title><h1>Docs page</h1>' : FORM_PAGE,
        { headers: { 'content-type': 'text/html' } },
      ),
    });
    origin = `http://127.0.0.1:${server.port}`;
    profile = await mkdtemp(join(tmpdir(), 'fl0w-chrome-'));
    chrome = Bun.spawn([CHROME!, '--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stderr: 'ignore', stdout: 'ignore' });
    const readPort = async () => {
      const portFile = Bun.file(join(profile, 'DevToolsActivePort'));
      return (await portFile.exists()) ? (await portFile.text()).trim().split('\n') : [];
    };
    for (let i = 0; i < 100 && (await readPort()).length < 2; i++) await Bun.sleep(100);
    const [port, path] = await readPort();
    browserSession.setConnector(async () => ({ connectUrl: `ws://127.0.0.1:${port}${path}`, liveViewUrl: 'https://live.example/session' }));
  }, 20_000);

  afterAll(async () => {
    await browserSession.close();
    chrome?.kill();
    server?.stop(true);
    await rm(profile, { recursive: true, force: true });
  });

  test('navigates, fills a form, submits it, and follows a new tab', async () => {
    const page = await browserSession.navigate({ url: origin });
    expect(page).toContain('Started a new browser session.');
    expect(page).toContain('https://live.example/session');
    expect(page).toContain('Page: Signup');
    expect(page).toContain('heading "Create account"');

    const name = refFor(page, /textbox "Name"/);
    const plan = refFor(page, /combobox "Plan"/);
    const terms = refFor(page, /checkbox "Accept terms"/);
    const filled = await browserSession.fillForm({ fields: [{ ref: name, value: 'Ada' }, { ref: plan, value: 'Pro' }, { ref: terms, value: true }] });
    expect(filled).toContain('Filled 3 fields');
    expect(filled).toContain('textbox "Name" value="Ada"');
    expect(filled).toMatch(/checkbox "Accept terms" \[checked\]/);

    await browserSession.click({ ref: refFor(filled, /button "Submit"/) });
    expect(await browserSession.evaluate({ expression: 'document.getElementById("out").textContent' }))
      .toBe(JSON.stringify(JSON.stringify({ name: 'Ada', plan: 'pro', terms: 'on' })));

    await browserSession.type({ ref: name, text: 'Grace', submit: true });
    expect(await browserSession.evaluate({ expression: 'JSON.parse(document.getElementById("out").textContent).name' })).toBe('"Grace"');

    expect(await browserSession.readLogs({ kind: 'console' })).toContain('[log] ready');

    const opened = await browserSession.click({ ref: refFor(filled, /link "Open docs"/) });
    expect(opened).toContain('opened a new tab');
    expect(opened).toContain('heading "Docs page"');
    expect(await browserSession.tabs({ action: 'list' })).toMatch(/\* Docs/);
  }, 60_000);

  test('takes screenshots and reports stale refs', async () => {
    const shot = await browserSession.screenshot({});
    const path = shot.match(/\[image:([^\]]+)\]/)?.[1];
    expect(path).toBeDefined();
    expect((await Bun.file(path!).bytes()).slice(1, 4)).toEqual(new TextEncoder().encode('PNG'));
    await expect(browserSession.click({ ref: 'e999999' })).rejects.toThrow(/no longer on the page/);
  }, 30_000);
});
