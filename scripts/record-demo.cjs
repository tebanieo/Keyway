/**
 * Records the README / docs demo: types a model at a human pace, with
 * social-media-style captions (the current word highlighted) and key badges,
 * generates sample data with @gen, then replays the writes. Writes one PNG per
 * frame plus durs.json (each frame's duration); scripts/make-gif.py turns them
 * into docs/public/demo.gif.
 *
 *   npm run build && npx vite preview --port 4173 --strictPort   # in one terminal
 *   node scripts/record-demo.cjs /tmp/demo-frames                  # needs Playwright
 *   python3 scripts/make-gif.py /tmp/demo-frames
 *
 * The caption overlay is injected here, for the recording only: it isn't part
 * of the app.
 */
const { chromium } = require("playwright");
const fs = require("fs");
(async () => {
  const out = process.argv[2] || "demo-frames";
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({
    viewport: { width: 1024, height: 600 },
    deviceScaleFactor: 1.25,
    colorScheme: "light",
  });
  await p.goto("http://localhost:4173/");
  await p.waitForTimeout(1500);
  // Recording-only overlay: a caption with a word highlight, and a key badge.
  await p.addStyleTag({
    content: `
    .cm-tooltip-autocomplete, .exit-armed::after { display: none !important; }
    #rec-cap { position: fixed; left: 50%; top: 64%; transform: translateX(-50%); z-index: 9999;
      display: flex; align-items: center; gap: 14px; padding: 12px 22px; border-radius: 16px;
      background: rgba(17, 20, 26, 0.86); color: #fff; font: 700 21px/1.25 "Space Grotesk", system-ui, sans-serif;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); max-width: 94vw; white-space: nowrap; pointer-events: none; }
    #rec-cap:empty { display: none; }
    #rec-cap .w { opacity: .55; }
    #rec-cap .w.on { opacity: 1; }
    #rec-cap .w.now { color: #111; background: #ffd23f; border-radius: 6px; padding: 0 5px; opacity: 1; }
    #rec-cap kbd { font: 700 19px/1 ui-monospace, monospace; color: #111; background: #fff; border-radius: 8px;
      padding: 7px 11px; box-shadow: inset 0 -3px 0 #c9ced8; }
    #rec-cap kbd.hot { background: #ffd23f; box-shadow: inset 0 -3px 0 #c99b00, 0 0 0 4px rgba(255,210,63,.35); }`,
  });
  await p.evaluate(() => {
    const d = document.createElement("div");
    d.id = "rec-cap";
    document.body.appendChild(d);
  });
  // upto: words lit so far (the last one is "now"); -1 = the whole sentence lit,
  // no word singled out (so a key badge can take the highlight)
  const cap = (text, upto, key) =>
    p.evaluate(
      ([text, upto, key]) => {
        const d = document.getElementById("rec-cap");
        if (!text) {
          d.innerHTML = "";
          return;
        }
        const words = text.split(" ");
        d.innerHTML =
          "<span>" +
          words
            .map(
              (w, i) =>
                `<span class="w${upto < 0 || i < upto ? " on" : ""}${i === upto - 1 ? " now" : ""}">${w}</span>`,
            )
            .join(" ") +
          "</span>" +
          (key ? `<kbd class="hot">${key}</kbd>` : "");
      },
      [text, upto, key],
    );

  let n = 0;
  const durs = [];
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const shot = async (ms) => {
    await p.screenshot({ path: `${out}/f${String(n).padStart(4, "0")}.png` });
    durs.push(Math.round(ms));
    n++;
  };
  // the menu is hidden by CSS while typing; close it for real only before a Tab
  const closeMenu = async () => {};
  const closeForTab = async () => {
    await p.waitForTimeout(120);
    if (await p.$(".cm-tooltip-autocomplete")) await p.keyboard.press("Escape");
  };

  // Type `text` at a human pace while the caption's highlight moves with it.
  const step = async (caption, text, { enter = true, hold = 900 } = {}) => {
    const words = caption.split(" ").length;
    for (let i = 0; i < text.length; i++) {
      await p.keyboard.insertText(text[i]);
      await p.waitForTimeout(20);
      await closeMenu();
      await cap(caption, Math.max(1, Math.ceil(((i + 1) / text.length) * words)), null);
      const ch = text[i];
      await shot(70 + rand() * 50 + (ch === " " ? 50 : 0) + (/[=#{}]/.test(ch) ? 30 : 0));
    }
    await cap(caption, words, null);
    await shot(hold);
    if (enter) {
      // the whole sentence stays; the Enter badge lights up, long enough to see
      await p.keyboard.press("Enter");
      await p.waitForTimeout(80);
      await cap(caption, -1, "↵ Enter");
      await shot(1200);
    }
  };

  // Compact rows, so more of the model fits on screen
  await p.click('button.chip:has-text("Compact")');
  await p.click(".cm-content");
  await p.keyboard.press("Control+a");
  await p.keyboard.press("Delete");
  await p.waitForTimeout(200);
  await cap("Model DynamoDB by typing it", 5, null);
  await shot(2200);
  await step("Create a table called AppTable", "@table AppTable pk=PK sk=SK");
  await step("Add an index to look orders up by status", "@gsi GSI1 pk=GSI1PK sk=GSI1SK");
  await step(
    "Build each order's keys from its own fields",
    "@key order  SK=ORDER#{date}  GSI1PK=STATUS#{status}  GSI1SK={date}",
    { hold: 1400 },
  );
  await step(
    "Add a customer",
    "c1: PK=CUSTOMER#ada  SK=PROFILE  name=Ada Lovelace  _type=customer",
    { hold: 1600 },
  );
  await step(
    "Add an order: its keys fill themselves in",
    "o1: PK=CUSTOMER#ada  date=2024-03-01  status=pending  total=42.00  _type=order",
    { hold: 2600 },
  );
  // sample data
  await step("Ask for 2 sample customers", "@gen customer 2", { enter: false, hold: 1000 });
  await closeForTab();
  await p.keyboard.press("Tab");
  await p.waitForTimeout(500);
  await closeMenu();
  await cap("Ask for 2 sample customers", -1, "⇥ Tab");
  await shot(2800);
  await p.keyboard.press("End");
  await p.keyboard.press("Enter");
  await closeMenu();
  await step(
    "…and 2 orders for each customer",
    "@gen order 2 per customer  status=pending|shipped",
    { enter: false, hold: 1000 },
  );
  await closeForTab();
  await p.keyboard.press("Tab");
  await p.waitForTimeout(600);
  await closeMenu();
  await cap("…and 2 orders for each customer", -1, "⇥ Tab");
  await shot(3400);
  // playback
  await p.evaluate(() => document.activeElement.blur());
  for (let i = 0; i < 12; i++) await p.keyboard.press("[");
  await p.waitForTimeout(400);
  // the caption introduces the replay, then gets out of the way
  await cap("Now replay every write, and see what it costs", -1, null);
  await shot(2600);
  await cap("", 0, null);
  for (let i = 0; i < 10; i++) {
    await p.keyboard.press("]");
    await p.waitForTimeout(450);
    await shot(1500);
  }
  await shot(2500);
  fs.writeFileSync(`${out}/durs.json`, JSON.stringify(durs));
  console.log("frames", n, "seconds", durs.reduce((a, c) => a + c, 0) / 1000);
  await b.close();
})();
