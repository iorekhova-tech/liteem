// Лайтуем · запись ленты → сразу в общую Telegram-группу.
// Вызывается Database Webhook'ом Supabase (feed_to_tg) на INSERT в таблицу feed.
// В дашборде Supabase функция задеплоена под именем hyper-processor.
//
// Секреты функции (Edge Functions → Secrets): BOT_TOKEN, CHAT_ID.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
//
// Из тела запроса берём только id: текст и фото перечитываем из базы,
// поэтому чужой вызов с выдуманной записью ничего в группу не отправит.
// Запись сначала «забираем» (posted_to_tg false → true), и только потом шлём —
// так cron-страховка в bot.py не продублирует сообщение.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("CHAT_ID") ?? "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

const sbHeaders = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tg(method: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log("TG", method, r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

Deno.serve(async (req) => {
  let id: unknown;
  try {
    id = (await req.json())?.record?.id;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!id || !BOT_TOKEN || !CHAT_ID) return new Response("skip");

  // забираем запись: вернётся строка, только если её ещё никто не отправил
  const claim = await fetch(
    `${SB_URL}/rest/v1/feed?id=eq.${encodeURIComponent(String(id))}&posted_to_tg=eq.false` +
      `&select=text,photo_url,user_id`,
    {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ posted_to_tg: true }),
    },
  );
  const rows = claim.ok ? await claim.json() : [];
  if (!rows.length) return new Response("already posted");
  const f = rows[0];

  const prof = await fetch(
    `${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(String(f.user_id))}&select=name`,
    { headers: sbHeaders },
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const name = prof[0]?.name || "Кто-то";
  // текст ленты приложение уже собирает в HTML (<b>…</b>, escapeHtml) — берём как есть
  const caption = `<b>${esc(name)}</b> ${f.text ?? ""}`;

  let ok = false;
  if (f.photo_url) {
    ok = await tg("sendPhoto", {
      chat_id: CHAT_ID, photo: f.photo_url, caption, parse_mode: "HTML",
    });
  }
  if (!ok) {
    await tg("sendMessage", {
      chat_id: CHAT_ID, text: caption, parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  }
  return new Response("ok");
});
