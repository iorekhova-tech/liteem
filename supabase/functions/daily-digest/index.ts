// Лайтуем · утро, вечер и срез по воде — по расписанию Supabase (pg_cron), минута в минуту.
// GitHub Actions запускал их с опозданием на 1–3 часа, поэтому перенесено сюда.
// Логика та же, что в bot.py (mode_morning / mode_evening / mode_water_snapshot).
//
// Вызов: POST /functions/v1/daily-digest  {"mode": "morning" | "evening" | "water"}
// с заголовком x-cron-secret — его ставит задача pg_cron (supabase/cron_daily_digest.sql).
// При деплое в дашборде выключить «Verify JWT»: вызов проверяется секретом, а не JWT.
//
// Секреты функции (Edge Functions → Secrets): BOT_TOKEN, CHAT_ID, CRON_SECRET.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("CHAT_ID") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

const sbHeaders = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function sbGet(path: string): Promise<Row[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders });
  if (!r.ok) {
    console.log("SB", r.status, path.split("?")[0], (await r.text()).slice(0, 200));
    return [];
  }
  return await r.json();
}

async function send(chatId: string, text: string) {
  if (!chatId) return;
  const r = await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
    }),
  });
  if (!r.ok) console.log("TG", chatId, r.status, (await r.text()).slice(0, 200));
}

// ---------------- данные ----------------
const MSK_MS = 3 * 3600 * 1000;
const todayMsk = () => new Date(Date.now() + MSK_MS).toISOString().slice(0, 10);

async function profiles(): Promise<Map<string, Row>> {
  const rows = await sbGet("profiles?select=*");
  return new Map(rows.map((r) => [String(r.id), r]));
}

async function latestWeights(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await sbGet("measures?select=user_id,weight,created_at&order=created_at.desc")) {
    const uid = String(r.user_id);
    if (!out.has(uid) && r.weight != null) out.set(uid, Number(r.weight));
  }
  return out;
}

const waterGoal = (uid: string, w: Map<string, number>) =>
  w.has(uid) ? Math.round(35 * w.get(uid)!) : 2000;

async function todayLogs(): Promise<Map<string, Row>> {
  const rows = await sbGet(
    `daily_logs?log_date=eq.${todayMsk()}&select=user_id,water,steps,meals,care,activity`,
  );
  return new Map(rows.map((r) => [String(r.user_id), r]));
}

function dayWord(n: number) {
  const a = Math.abs(n) % 100, b = n % 10;
  if (a > 10 && a < 20) return "дней";
  if (b === 1) return "день";
  if (b >= 2 && b <= 4) return "дня";
  return "дней";
}

const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// ---------------- режимы ----------------
const MORNING = [
  "Новый день — новый шаг к себе. Ты уже в пути 🌸",
  "Маленькое действие сегодня = большой результат через месяц. Погнали 💪",
  "Ты не обязана быть идеальной. Достаточно быть на шаг ближе, чем вчера 🌿",
  "Забота о себе — это не награда за успех, а его начало. С добрым утром 💛",
  "Тело скажет спасибо за каждый сегодняшний выбор. Начнём с малого ✨",
  "Ты уже доказала, что умеешь начинать. Сегодня просто продолжи 🌷",
  "Дисциплина — это любовь к себе в действии. Ты справишься 🌟",
  "Один стакан воды, одна галочка — и день уже пошёл правильно 💧",
  "Не сравнивай себя с другими. Твой темп — правильный темп 🌸",
  "Каждый отмеченный пункт — это маленькая победа. Собери их сегодня 🏆",
  "Сложно не значит невозможно. Ты уже это знаешь 💪",
  "Ты создаёшь привычку, которая изменит всё. Продолжай 🌱",
  "Сегодня — идеальный день, чтобы быть к себе чуть добрее и чуть внимательнее 🤍",
  "Прогресс не всегда виден сразу, но он есть в каждом твоём выборе 🌼",
  "Ты сильнее любой отговорки. Докажи это себе сегодня 🔥",
  "С добрым утром! Пусть этот день будет за тебя, а не против 🌅",
];

async function morning() {
  for (const [uid, p] of await profiles()) {
    const phrase = MORNING[Math.floor(Math.random() * MORNING.length)];
    await send(uid, `☀️ Доброе утро, ${p.name}!\n\n${phrase}\n\nЗагляни в Лайтуем и отметь первый пункт 🌿`);
  }
}

async function evening() {
  const [profs, weights, logs, refus] = await Promise.all([
    profiles(), latestWeights(), todayLogs(),
    sbGet("refusals?active=eq.true&select=title,started_on,user_id"),
  ]);
  const refBy = new Map<string, Row[]>();
  for (const r of refus) {
    const k = String(r.user_id);
    refBy.set(k, [...(refBy.get(k) ?? []), r]);
  }
  const today = Date.parse(todayMsk());

  for (const [uid, p] of profs) {
    const d = logs.get(uid) ?? {};
    const meals = d.meals ?? {};
    const food: Row[] = meals.food ?? [];
    const lower = (a: string[]) => a.map((s) => s.toLowerCase()).join(", ");

    // полный отчёт: каждая строка есть всегда, неотмеченное — «не отмечено»
    const report: string[] = [];
    const MEAL_RU: Record<string, string> = { breakfast: "завтрак", lunch: "обед", dinner: "ужин" };
    if (food.length) {
      const kcal = food.reduce((s, f) => s + (parseInt(f.kcal) || 0), 0);
      const goal = p.kcal_goal || 1500;
      report.push(`🍽️ Питание: ${fmt(kcal)} из ${fmt(goal)} ккал` + (kcal <= goal ? " ✅" : ""));
    } else {
      const done = Object.keys(MEAL_RU).filter((m) => meals[m]?.base);
      report.push(done.length
        ? `🍽️ Питание: ${done.map((m) => MEAL_RU[m]).join(", ")} — ${done.length} из 3` + (done.length === 3 ? " ✅" : "")
        : "🍽️ Питание: не отмечено");
    }
    const sweet = parseInt(meals.sweet) || 0;
    const sweetLim = p.sweet_limit || 100;
    report.push(`🍬 Сладкое: ${sweet} из ${sweetLim} г` + (sweet <= sweetLim ? " ✅" : ""));
    report.push(`💪 Активность: ${d.activity?.length ? lower(d.activity) + " ✅" : "не отмечено"}`);
    const steps = parseInt(d.steps) || 0;
    report.push(`👟 Шаги: ${fmt(steps)} из 8 000` + (steps >= 8000 ? " ✅" : ""));
    const wGoal = waterGoal(uid, weights), wDrunk = parseInt(d.water) || 0;
    report.push(`💧 Вода: ${fmt(wDrunk)} из ${fmt(wGoal)} мл` + (wDrunk >= wGoal ? " ✅" : ""));
    report.push(`🫧 Уход: ${d.care?.length ? lower(d.care) + " ✅" : "не отмечено"}`);
    const anything = food.length || Object.keys(MEAL_RU).some((m) => meals[m]?.base) ||
      sweet || d.activity?.length || steps || wDrunk || d.care?.length;

    const streaks: string[] = [];
    for (const r of refBy.get(uid) ?? []) {
      const s = Date.parse(String(r.started_on).slice(0, 10));
      if (isNaN(s)) continue;
      const n = Math.round((today - s) / 86400000) + 1;
      streaks.push(`уже ${n} ${dayWord(n)} без «${r.title}»`);
    }

    const lines = [`🌙 ${p.name}, подводим итог дня!`];
    lines.push(...report);
    if (!anything) lines.push("Сегодня без отметок — ничего, завтра начнём заново, ты справишься 🌷");
    if (streaks.length) lines.push("🔥 " + streaks.join("; ") + " — так держать!");
    lines.push("Ты умница 💛");
    await send(CHAT_ID, lines.join("\n"));
  }
}

async function water() {
  const [profs, logs] = await Promise.all([profiles(), todayLogs()]);
  const parts = [...profs].map(([uid, p]) => `${p.name} — <b>${logs.get(uid)?.water || 0}</b> мл`);
  if (parts.length) await send(CHAT_ID, "💧 Срез по воде:\n" + parts.join("\n"));
}

const MODES: Record<string, () => Promise<void>> = { morning, evening, water };

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let mode = "";
  try {
    mode = String((await req.json())?.mode ?? "");
  } catch { /* пустое тело */ }
  if (!MODES[mode]) return new Response("unknown mode", { status: 400 });
  if (!BOT_TOKEN) return new Response("no BOT_TOKEN", { status: 500 });
  await MODES[mode]();
  return new Response(`ok ${mode}`);
});
