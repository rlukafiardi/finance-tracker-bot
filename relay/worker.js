// Cloudflare Worker relay: Telegram -> this Worker (answers 200 at once) -> Apps Script web app.
// Apps Script answers webhooks with a 302, which Telegram treats as a failed delivery: it keeps resending
// the same update and newer messages queue up behind it. Replying 200 here avoids that.
//
// Worker secrets (Settings > Variables and Secrets, type Secret):
//   TELEGRAM_SECRET  same value as the WEBHOOK_SECRET script property
//   APPS_SCRIPT_URL  the web app /exec URL + "?secret=" + WEBHOOK_SECRET

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('ok');
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const body = await request.text();
    // Apps Script runs doPost before it sends its 302, so the redirect does not need to be followed.
    ctx.waitUntil(fetch(env.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
      redirect: 'manual',
    }));
    return new Response('ok');
  },
};
