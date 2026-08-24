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
      :root { color-scheme: light; font-family: Tahoma, Arial, sans-serif; background: #f7f7f4; color: #19221d; }
      * { box-sizing: border-box; }
      body { margin: 0; min-block-size: 100vh; }
      a { color: inherit; }
      .shell { inline-size: min(1120px, calc(100% - 32px)); margin-inline: auto; padding-block: 24px 48px; }
      .topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-block-end: 1px solid #dfe5df; padding-block-end: 16px; }
      .brand { font-weight: 800; text-decoration: none; font-size: 1.2rem; }
      .muted { color: #617064; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px; }
      .card { background: #fff; border: 1px solid #dfe5df; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgb(32 50 36 / 6%); }
      .hero { padding-block: 56px 36px; max-inline-size: 760px; }
      h1 { font-size: clamp(2rem, 6vw, 4rem); line-height: 1.08; margin: 0 0 16px; }
      h2 { margin-block-start: 0; }
      p { line-height: 1.75; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-block-start: 24px; }
      .button { border: 0; border-radius: 10px; background: #1c6d45; color: #fff; cursor: pointer; display: inline-block; font: inherit; font-weight: 700; padding-block: 12px; padding-inline: 18px; text-decoration: none; }
      .button.secondary { background: #e7efe9; color: #19472f; }
      label { display: grid; gap: 7px; font-weight: 700; }
      input, select, textarea { border: 1px solid #bcc9be; border-radius: 9px; font: inherit; padding-block: 11px; padding-inline: 12px; inline-size: 100%; }
      textarea { min-block-size: 112px; resize: vertical; }
      form { display: grid; gap: 14px; }
      .notice { border-inline-start: 4px solid #d59f21; background: #fff6df; border-radius: 8px; padding: 12px; }
      .status { border-radius: 999px; display: inline-block; font-size: .88rem; font-weight: 700; padding-block: 5px; padding-inline: 10px; background: #e7efe9; color: #19472f; }
      .status.pending { background: #fff3d3; color: #795805; }
      .status.warning { background: #fff0ed; color: #9d3d2e; }
      .sidebar-layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 20px; margin-block-start: 28px; }
      .sidebar { align-self: start; }
      .sidebar a { display: block; padding-block: 9px; text-decoration: none; }
      .sidebar a:hover { text-decoration: underline; }
      .error { color: #9d3d2e; min-block-size: 1.25rem; }
      @media (max-width: 720px) { .sidebar-layout { grid-template-columns: 1fr; } .topbar { align-items: flex-start; flex-direction: column; } }
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
