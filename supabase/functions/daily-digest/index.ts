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

// В личке под сообщением — кнопка, открывающая приложение (web_app-кнопки Telegram пускает только в личку)
const APP_URL = "https://iorekhova-tech.github.io/liteem/";
const OPEN_BTN = { inline_keyboard: [[{ text: "🌸 Открыть Лайтуем", web_app: { url: APP_URL } }]] };

async function send(chatId: string, text: string, button = false) {
  if (!chatId) return;
  const r = await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
      ...(button ? { reply_markup: OPEN_BTN } : {}),
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
    await send(uid, `☀️ Доброе утро, ${p.name}!\n\n${phrase}\n\nЗагляни в Лайтуем и отметь первый пункт 🌿`, true);
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
    const snack = meals.snack?.base ? parseInt(meals.snack.base) || 0 : 0;
    if (food.length) {
      const kcal = food.reduce((s, f) => s + (parseInt(f.kcal) || 0), 0);
      const goal = p.kcal_goal || 1500;
      report.push(`🍽️ Питание: ${fmt(kcal)} из ${fmt(goal)} ккал` + (kcal <= goal ? " ✅" : ""));
      // БЖУ — если вносила; цель берём из калькулятора КБЖУ (profiles.body)
      const sum = (k: string) => Math.round(food.reduce((s, f) => s + (Number(f[k]) || 0), 0));
      if (food.some((f) => f.p || f.f || f.c)) {
        const b = p.body ?? {};
        const part = (lbl: string, v: number, g?: number) => `${lbl} ${v}` + (g ? `/${g}` : "");
        report.push(`   ${part("Б", sum("p"), b.p)} · ${part("Ж", sum("f"), b.f)} · ${part("У", sum("c"), b.c)} г`);
      }
    } else {
      const done = Object.keys(MEAL_RU).filter((m) => meals[m]?.base);
      const snackTxt = snack ? ` + перекус${meals.snack.what ? ` (${String(meals.snack.what).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")})` : ""}` : "";
      report.push(done.length || snack
        ? `🍽️ Питание: ${done.map((m) => MEAL_RU[m]).join(", ")} — ${done.length} из 3${snackTxt}` + (done.length === 3 ? " ✅" : "")
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
    const anything = food.length || snack || Object.keys(MEAL_RU).some((m) => meals[m]?.base) ||
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
  // воскресенье по МСК — следом сводка недели
  if (new Date(Date.now() + MSK_MS).getUTCDay() === 0) await weekly();
}

// ---------------- сводка недели (воскресенье, после итога дня) ----------------
// Питание — по системе каждой: «Считаю калории» — средние ккал и БЖУ, граммовки — сколько приёмов
// заполнено из 21. Вес — только разница, как в ленте: сами цифры видны лишь хозяйке.
const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
async function weekly() {
  const now = new Date(Date.now() + MSK_MS);
  const mon = new Date(now); mon.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  const monKey = mon.toISOString().slice(0, 10), today = todayMsk();
  const [profs, logs, meas] = await Promise.all([
    profiles(),
    sbGet(`daily_logs?log_date=gte.${monKey}&log_date=lte.${today}&select=user_id,log_date,water,steps,meals,care,activity`),
    sbGet("measures?select=user_id,weight,created_at&order=created_at.asc"),
  ]);
  const weights = await latestWeights();
  const sun = new Date(Date.parse(today)), monD = new Date(Date.parse(monKey));
  const dm = (d: Date) => `${d.getUTCDate()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const out: string[] = [`📅 <b>Итоги недели ${dm(monD)}–${dm(sun)}</b>`];

  for (const [uid, p] of profs) {
    const days = logs.filter((l) => String(l.user_id) === uid);
    const L: string[] = [`\n<b>${p.name}</b>`];
    const filled = days.filter((d) => {
      const m = d.meals ?? {};
      return (m.food?.length) || ["breakfast", "lunch", "dinner", "snack"].some((k) => m[k]?.base) ||
        d.activity?.length || d.care?.length || (d.steps || 0) > 0 || (d.water || 0) > 0;
    }).length;
    L.push(`✍️ Отмечалась ${filled} из 7 дней`);

    // питание
    const foodDays = days.filter((d) => d.meals?.food?.length);
    if (p.system === "kcal" || foodDays.length > days.length / 2) {
      if (foodDays.length) {
        const tot = (d: Row, k: string) => (d.meals.food as Row[]).reduce((s, f) => s + (Number(f[k]) || 0), 0);
        const goal = p.kcal_goal || 1500;
        const kc = foodDays.map((d) => tot(d, "kcal"));
        const inNorm = kc.filter((k) => k <= goal).length;
        L.push(`🍽️ В среднем ${fmt(Math.round(avg(kc)))} из ${fmt(goal)} ккал · в норме ${inNorm} из ${foodDays.length} дн.`);
        if (foodDays.some((d) => (d.meals.food as Row[]).some((f) => f.p || f.f || f.c))) {
          const b = p.body ?? {};
          const a = (k: string) => Math.round(avg(foodDays.map((d) => tot(d, k))));
          L.push(`   Б ${a("p")}${b.p ? "/" + b.p : ""} · Ж ${a("f")}${b.f ? "/" + b.f : ""} · У ${a("c")}${b.c ? "/" + b.c : ""} г в день`);
        }
      } else L.push("🍽️ Питание не записывала");
    } else {
      const meals = days.reduce((s, d) => s + ["breakfast", "lunch", "dinner"].filter((k) => d.meals?.[k]?.base).length, 0);
      const snacks = days.filter((d) => d.meals?.snack?.base).length;
      L.push(`🍽️ Приёмов пищи ${meals} из 21` + (snacks ? ` · перекусов ${snacks}` : "") + (meals >= 18 ? " ✅" : ""));
    }

    // сладкое, активность, шаги, вода, уход
    const lim = p.sweet_limit || 100;
    const sweetDays = days.map((d) => parseInt(d.meals?.sweet) || 0);
    const over = sweetDays.filter((x) => x > lim).length;
    L.push(`🍬 Сладкое в норме ${7 - over} из 7 дн.` + (over ? "" : " ✅"));
    const acts = days.flatMap((d) => d.activity ?? []);
    if (acts.length) {
      const cnt = new Map<string, number>();
      for (const a of acts) cnt.set(a, (cnt.get(a) ?? 0) + 1);
      L.push(`💪 Активность ${acts.length} раз: ${[...cnt].map(([a, n]) => `${a.toLowerCase()}${n > 1 ? " ×" + n : ""}`).join(", ")}`);
    } else L.push("💪 Активность не отмечала");
    const steps = days.map((d) => parseInt(d.steps) || 0);
    L.push(`👟 Шаги: в среднем ${fmt(Math.round(steps.reduce((s, x) => s + x, 0) / 7))} в день · цель взята ${steps.filter((x) => x >= 8000).length} из 7`);
    const wg = waterGoal(uid, weights);
    L.push(`💧 Вода в норме ${days.filter((d) => (d.water || 0) >= wg).length} из 7 дн.`);
    const care = days.reduce((s, d) => s + (d.care?.length || 0), 0);
    if (care) L.push(`🫧 Уход — ${care} раз`);

    // вес за неделю: последний замер недели против последнего до неё — только разница
    const mine = meas.filter((m) => String(m.user_id) === uid && m.weight != null);
    const before = mine.filter((m) => String(m.created_at).slice(0, 10) < monKey).at(-1);
    const thisWeek = mine.filter((m) => String(m.created_at).slice(0, 10) >= monKey).at(-1);
    if (before && thisWeek) {
      const d = Math.round((Number(thisWeek.weight) - Number(before.weight)) * 10) / 10;
      L.push(d < 0 ? `⚖️ Минус ${String(-d).replace(".", ",")} кг за неделю 🔥`
        : d > 0 ? `⚖️ Плюс ${String(d).replace(".", ",")} кг — бывает, идём дальше 💛` : "⚖️ Вес стабилен");
    }
    out.push(L.join("\n"));
  }
  out.push("\nНовая неделя — новые галочки. Вы молодцы 💛");
  // длинное сообщение режем по 4000 знаков (лимит Telegram 4096)
  let chunk = "";
  for (const part of out) {
    if ((chunk + "\n" + part).length > 4000) { await send(CHAT_ID, chunk); chunk = ""; }
    chunk += (chunk ? "\n" : "") + part;
  }
  if (chunk) await send(CHAT_ID, chunk);
}

// ---------------- напоминание в личку (21:00) ----------------
// Только тем, у кого день не заполнен; пишем, что именно осталось. Всё отмечено — не беспокоим.
async function remind() {
  const [profs, weights, logs] = await Promise.all([profiles(), latestWeights(), todayLogs()]);
  for (const [uid, p] of profs) {
    const d = logs.get(uid) ?? {};
    const m = d.meals ?? {};
    const miss: string[] = [];
    const food = m.food?.length || ["breakfast", "lunch", "dinner", "snack"].some((k) => m[k]?.base);
    if (!food) miss.push("питание");
    if ((parseInt(d.water) || 0) < waterGoal(uid, weights) / 2) miss.push("воду");
    if (!d.activity?.length) miss.push("активность");
    if (!(parseInt(d.steps) || 0)) miss.push("шаги");
    if (!miss.length) continue;
    const empty = miss.length >= 4;
    await send(uid, empty
      ? `🌙 ${p.name}, сегодня ещё ни одной отметки. До итога дня 3 часа — загляни на минутку, отметь что успела 🌿`
      : `🌙 ${p.name}, до итога дня 3 часа. Ещё не отмечено: ${miss.join(", ")}. Добьём? 💪`, true);
  }
}

async function water() {
  const [profs, logs] = await Promise.all([profiles(), todayLogs()]);
  const parts = [...profs].map(([uid, p]) => `${p.name} — <b>${logs.get(uid)?.water || 0}</b> мл`);
  if (parts.length) await send(CHAT_ID, "💧 Срез по воде:\n" + parts.join("\n"));
}

const MODES: Record<string, () => Promise<void>> = { morning, evening, water, weekly, remind };

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
