function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function pageLayout(input: Readonly<{ title: string; body: string }>): string {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>${escapeHtml(input.title)} | هالة</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Tahoma, Arial, sans-serif;
        background: #f7f7f7;
        color: #171717;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-block-size: 100vh; background: #f7f7f7; }
      a { color: inherit; }
      a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
        outline: 3px solid #171717;
        outline-offset: 3px;
      }
      .shell { inline-size: min(1120px, calc(100% - 32px)); margin-inline: auto; padding-block: 24px 48px; }
      .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-block-end: 1px solid #d4d4d4; padding-block-end: 16px; }
      .brand { font-weight: 800; text-decoration: none; font-size: 1.2rem; letter-spacing: 0; }
      .muted { color: #5c5c5c; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
      .card { background: #fff; border: 1px solid #d4d4d4; border-radius: 14px; padding: 20px; box-shadow: 0 10px 28px rgb(0 0 0 / 5%); }
      .hero { padding-block: 56px 36px; max-inline-size: 760px; }
      h1 { font-size: clamp(2rem, 6vw, 4rem); line-height: 1.08; margin: 0 0 16px; }
      h2 { margin-block-start: 0; }
      p { line-height: 1.75; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block-start: 24px; }
      .button { border: 1px solid #171717; border-radius: 9px; background: #171717; color: #fff; cursor: pointer; display: inline-block; font: inherit; font-weight: 700; padding-block: 12px; padding-inline: 18px; text-decoration: none; }
      .button:hover { background: #303030; }
      .button.secondary { background: #fff; color: #171717; }
      .button.secondary:hover { background: #ededed; }
      label { display: grid; gap: 7px; font-weight: 700; }
      input, select, textarea { border: 1px solid #8a8a8a; border-radius: 8px; background: #fff; color: #171717; font: inherit; padding-block: 11px; padding-inline: 12px; inline-size: 100%; }
      input::placeholder, textarea::placeholder { color: #707070; }
      textarea { min-block-size: 112px; resize: vertical; }
      form { display: grid; gap: 14px; }
      .notice { border-inline-start: 4px solid #171717; background: #ededed; border-radius: 8px; padding: 12px; }
      .status { border: 1px solid #171717; border-radius: 999px; display: inline-block; font-size: .88rem; font-weight: 700; padding-block: 5px; padding-inline: 10px; background: #fff; color: #171717; }
      .status.pending { border-style: dashed; background: #f1f1f1; color: #171717; }
      .status.warning { background: #171717; color: #fff; }
      .sidebar-layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 20px; margin-block-start: 28px; }
      .sidebar { align-self: start; }
      .sidebar a { display: block; padding-block: 9px; text-decoration: none; }
      .sidebar a:hover { text-decoration: underline; }
      .error { color: #171717; font-weight: 700; min-block-size: 1.25rem; }
      @media (max-width: 720px) {
        .sidebar-layout { grid-template-columns: 1fr; }
        .topbar { align-items: flex-start; flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main class="shell">${input.body}</main>
  </body>
</html>`;
}

export function escapedText(value: string): string {
  return escapeHtml(value);
}
