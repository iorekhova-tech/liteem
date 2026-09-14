#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Лайтуем · уведомления в Telegram.
Запускается по расписанию из GitHub Actions (.github/workflows/liteem-bot.yml).
Режим выбирается автоматически по расписанию, которое его запустило,
или вручную через workflow_dispatch (поле mode).
 
Секреты (GitHub → Settings → Secrets → Actions):
  BOT_TOKEN — токен бота от BotFather
  CHAT_ID   — id общей группы (отрицательное число, см. инструкцию)
 
SB_URL / SB_KEY — публичные значения Supabase (те же, что в index.html),
их можно держать прямо в коде: это публичный ключ, он и так виден на сайте.
"""
import os, json, random, datetime, urllib.request, urllib.error
 
SB_URL = "https://mikubhndfhhtoswletmj.supabase.co"
SB_KEY = "sb_publishable_wch05xP3x7rF8_RjCP52Zg_H8tIQXxx"
 
BOT_TOKEN  = os.environ.get("BOT_TOKEN", "")
GROUP_CHAT = os.environ.get("CHAT_ID", "")
TG = f"https://api.telegram.org/bot{BOT_TOKEN}"
 
MSK = datetime.timezone(datetime.timedelta(hours=3))
def today_msk():
    return datetime.datetime.now(MSK).date().isoformat()
 
# ---------------- сеть ----------------
def http(url, method="GET", headers=None, data=None):
    h = dict(headers or {})
    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else True
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, url.split("?")[0], e.read().decode("utf-8", "ignore")[:200])
    except Exception as e:
        print("ERR", url.split("?")[0], repr(e))
    return None
 
def sb_get(path):
    return http(f"{SB_URL}/rest/v1/{path}",
                headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}) or []
 
def sb_patch(path, data):
    return http(f"{SB_URL}/rest/v1/{path}", method="PATCH",
                headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                         "Prefer": "return=minimal"}, data=data)
 
def send(chat_id, text):
    if not chat_id:
        return
    http(f"{TG}/sendMessage", method="POST",
         data={"chat_id": chat_id, "text": text,
               "parse_mode": "HTML", "disable_web_page_preview": True})
 
def send_photo(chat_id, photo, caption):
    if not chat_id:
        return
    ok = http(f"{TG}/sendPhoto", method="POST",
              data={"chat_id": chat_id, "photo": photo,
                    "caption": caption, "parse_mode": "HTML"})
    if ok is None:            # если фото не ушло — отправим хотя бы текст
        send(chat_id, caption)
 
# ---------------- данные ----------------
def profiles():
    # select=* — чтобы бот не падал, если новые колонки (sweet_limit, kcal_goal) ещё не добавлены
    return {str(r["id"]): r for r in sb_get("profiles?select=*")}
 
def latest_weights():
    out = {}
    for r in sb_get("measures?select=user_id,weight,created_at&order=created_at.desc"):
        uid = str(r["user_id"])
        if uid not in out and r.get("weight") is not None:
            out[uid] = float(r["weight"])
    return out
 
def water_goal(uid, weights):
    w = weights.get(str(uid))
    return round(35 * w) if w else 2000
 
def today_logs():
    rows = sb_get(f"daily_logs?log_date=eq.{today_msk()}"
                  "&select=user_id,water,steps,meals,care,activity")
    return {str(r["user_id"]): r for r in rows}
 
def day_word(n):
    a, b = abs(n) % 100, n % 10
    if 10 < a < 20: return "дней"
    if b == 1:      return "день"
    if 2 <= b <= 4: return "дня"
    return "дней"
 
# ---------------- режимы ----------------
def mode_feed():
    """Страховка ленты: основной путь — Edge Function feed-to-tg по вебхуку Supabase.
    Здесь добираем только то, что вебхук пропустил. Запись сначала забираем
    (posted_to_tg false → true), и шлём, только если забрали мы, — без дублей."""
    rows = sb_get("feed?posted_to_tg=eq.false"
                  "&select=id,text,photo_url,user_id&order=created_at.asc")
    profs = profiles()
    for f in rows:
        claimed = http(f"{SB_URL}/rest/v1/feed?id=eq.{f['id']}&posted_to_tg=eq.false&select=id",
                       method="PATCH",
                       headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}",
                                "Prefer": "return=representation"},
                       data={"posted_to_tg": True})
        if not claimed:       # уже отправила функция или запрос не прошёл
            continue
        name = (profs.get(str(f.get("user_id"))) or {}).get("name") or "Кто-то"
        caption = f"<b>{name}</b> {f.get('text', '')}"
        if f.get("photo_url"):
            send_photo(GROUP_CHAT, f["photo_url"], caption)
        else:
            send(GROUP_CHAT, caption)
        sb_patch(f"feed?id=eq.{f['id']}", {"posted_to_tg": True})
 
def mode_water_remind():
    """Личное напоминание попить воды (в личку каждой)."""
    profs, weights, logs = profiles(), latest_weights(), today_logs()
    for uid, p in profs.items():
        goal = water_goal(uid, weights)
        drunk = (logs.get(uid) or {}).get("water") or 0
        if drunk >= goal:            # уже выполнила — не дёргаем
            continue
        send(uid, f"💧 {p['name']}, попей водички!\n"
                  f"Сегодня {drunk} из {goal} мл — осталось {goal - drunk} мл 🫧")
 
def mode_water_snapshot():
    """Срез по воде → в группу (12/16/20 МСК)."""
    profs, logs = profiles(), today_logs()
    parts = [f"{p['name']} — <b>{(logs.get(uid) or {}).get('water') or 0}</b> мл"
             for uid, p in profs.items()]
    if parts:
        send(GROUP_CHAT, "💧 Срез по воде:\n" + "\n".join(parts))
 
MORNING = [
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
]
def mode_morning():
    """Утренняя мотивация + приглашение заполнить (в личку каждой)."""
    for uid, p in profiles().items():
        send(uid, f"☀️ Доброе утро, {p['name']}!\n\n{random.choice(MORNING)}\n\n"
                  f"Загляни в Лайтуем и отметь первый пункт 🌿")
 
def mode_evening():
    """Вечерний срез по каждой + челлендж отказов → в группу."""
    profs, weights, logs = profiles(), latest_weights(), today_logs()
    refus = sb_get("refusals?active=eq.true&select=title,started_on,user_id")
    ref_by = {}
    for r in refus:
        ref_by.setdefault(str(r["user_id"]), []).append(r)
    today = datetime.datetime.now(MSK).date()
 
    for uid, p in profs.items():
        d = logs.get(uid) or {}
        wins = []
        meals = d.get("meals") or {}
        food = meals.get("food") or []
        if food:
            kcal = sum(int(f.get("kcal") or 0) for f in food)
            goal = p.get("kcal_goal") or 1500
            wins.append(f"уложилась в {goal} ккал 🍽️" if kcal <= goal else "записала питание 🍽️")
        elif any((meals.get(m) or {}).get("base") for m in ("breakfast", "lunch", "dinner")):
            wins.append("отметила питание 🍽️")
        sweet = int(meals.get("sweet") or 0)
        if 0 < sweet <= (p.get("sweet_limit") or 100):
            wins.append("сладкое в норме 🍬")
        if d.get("care"):     wins.append("уход за собой 🫧")
        if d.get("activity"): wins.append("активность 💪")
        if (d.get("steps") or 0) >= 8000: wins.append("прошла 8000 шагов 👟")
        if (d.get("water") or 0) >= water_goal(uid, weights): wins.append("выпила норму воды 💧")
 
        streaks = []
        for r in ref_by.get(uid, []):
            try:
                s = datetime.date.fromisoformat(str(r["started_on"])[:10])
                n = (today - s).days + 1
                streaks.append(f"уже {n} {day_word(n)} без «{r['title']}»")
            except Exception:
                pass
 
        lines = [f"🌙 {p['name']}, подводим итог дня!"]
        lines.append("Сегодня ты: " + ", ".join(wins) + "." if wins
                     else "Сегодня без отметок — ничего, завтра начнём заново, ты справишься 🌷")
        if streaks:
            lines.append("🔥 " + "; ".join(streaks) + " — так держать!")
        lines.append("Ты умница 💛")
        send(GROUP_CHAT, "\n".join(lines))
 
def mode_diag():
    """Разовая диагностика: печатает id всех чатов, которые видит бот.
    Запускать вручную (Run workflow → mode: diag), затем прочитать лог."""
    data = http(f"{TG}/getUpdates")
    seen = {}
    for u in ((data or {}).get("result") or []):
        for key in ("message", "edited_message", "channel_post", "my_chat_member", "chat_member"):
            m = u.get(key)
            if m and m.get("chat"):
                c = m["chat"]
                seen[c["id"]] = f"{c.get('title') or c.get('username') or c.get('first_name') or '?'} ({c.get('type')})"
    print("=" * 40)
    if seen:
        print("НАЙДЕННЫЕ ЧАТЫ (ищи свою группу, id будет отрицательным):")
        for cid, name in seen.items():
            print(f"  CHAT_ID = {cid}   <-  {name}")
    else:
        print("Чатов не видно. В группе напиши  /start@laytuem_bot  и запусти diag снова.")
    print("=" * 40)
 
MODES = {
    "feed": mode_feed, "water_remind": mode_water_remind,
    "water_snapshot": mode_water_snapshot, "morning": mode_morning,
    "evening": mode_evening, "diag": mode_diag,
}
SCHEDULE_MAP = {
    "17 * * * *":           "feed",
    "0 9,13,17 * * *":      "water_snapshot",
    "0 5 * * *":            "morning",
    "30 18 * * *":          "evening",
}
def pick_mode():
    m = (os.environ.get("MODE") or "").strip()
    if m in MODES:
        return m
    return SCHEDULE_MAP.get((os.environ.get("SCHEDULE") or "").strip(), "feed")
 
if __name__ == "__main__":
    if not BOT_TOKEN:
        print("BOT_TOKEN missing — nothing to do"); raise SystemExit(0)
    mode = pick_mode()
    print("Лайтуем bot · режим:", mode)
    MODES[mode]()
 
