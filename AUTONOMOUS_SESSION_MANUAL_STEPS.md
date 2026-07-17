# Autonóm munkamenet — Manuális lépések (amikre TŐLED van szükség)

> Ez a fájl gyűlik, ahogy a Map/Canvas Luma-ToDo listát és a Kooperatív-munka ToDo-t építem.
> Minden itt listázott lépés **manuális** (migráció alkalmazása / edge-deploy / megosztott DB-írás), amit én
> a biztonsági szabályok miatt nem futtatok le. A kód **kecsesen degradál** (graceful degradation): a migráció
> alkalmazása ELŐTT sem omlik össze semmi — a funkció egyszerűen inaktív, amíg a migrációt le nem futtatod.

## Hogyan alkalmazd a migrációkat
A `backend/migration-*.sql` fájlokat a Supabase SQL editorban (projekt ref: `jokqthwszkweyqmmdesn`) futtasd le,
sorrendben. A service-key nem tud DDL-t futtatni, ezért ezek manuálisak.

---

## Alkalmazandó migrációk (sorrendben)

1. **`backend/migration-70-map-node-flags.sql`** — per-node Map pin + hide flag a `research_map_layout`-on.
   - Amíg nincs lefuttatva: a Map-en NEM jelenik meg a 📌 kitűzés / 🙈 elrejtés / „Rejtett kártyák" panel
     (a kliens érzékeli a hiányzó oszlopokat és kikapcsolva hagyja — semmi nem törik el).
   - Utána: a lebegő selection-toolbar 📌/🙈 gombjai + a `🫥N` restore-panel élővé válnak.

2. **`backend/migration-71-map-frames.sql`** — Map keretek (nevesített régiók / fázis-lane-ek): `research_map_frames` tábla.
   - Amíg nincs lefuttatva: a `▦` (keret-létrehozás) gomb NEM jelenik meg; a Map változatlan.
   - Utána: kereteket lehet létrehozni, mozgatni/átméretezni, átnevezni, átszínezni, törölni;
     a keret alján a hover-re megjelenő „✨ Generálj ide…" inline input a keret témájában küld az asszisztensnek.

3. **`backend/migration-72-map-comments.sql`** — Map kommentek/annotációk: `research_map_comments` tábla.
   - **Fontos RLS-döntés:** INSERT-et bármely projekt-OLVASÓ megtehet (a read-only konzulens is tud kommentelni);
     az UPDATE/DELETE csak a szerző vagy egy szerkesztő joga.
   - Amíg nincs lefuttatva: a `💬` komment-mód gomb + `📋` panel NEM jelenik meg; a Map változatlan.
   - Utána: `💬` komment-mód → kattints a vászonra (pozícióhoz tűzött) vagy egy kártyára (kártyához tűzött) komment;
     kártyán `💬N` jelvény; pozíció-pin a vásznon; thread-popover (megoldva/törlés/válasz); `📋` összes-komment panel.

4. **`backend/migration-73-map-pages.sql`** — Map lapok/nézetek: `research_map_pages` tábla.
   - Amíg nincs lefuttatva: a bal-felső lap-sáv NEM jelenik meg; a Map változatlan.
   - Utána: „Teljes gráf" + mentett nézetek (viewport) fülek; `＋` új nézet az aktuális nagyításból;
     az aktív lapon `📌 Kurált` (csak kitűzöttek), `⟳ Nézet` (viewport-frissítés), átnevezés, törlés.

5. **`backend/migration-74-project-members.sql`** — ⚠️ **BIZTONSÁG-ÉRZÉKENY — NÉZD ÁT, MIELŐTT FUTTATOD.**
   Kooperatív munka Phase 1: `research_project_members` tábla + a `research_can_write_project` /
   `research_can_read_project` gate-függvények **átírása** úgy, hogy az elfogadott közreműködők is
   hozzáférnek a projekthez (owner/editor → írás; commenter/viewer → olvasás). A meglévő
   owner/admin/student/supervisor logika **változatlan**, a tagság OR-ral van hozzáadva.
   - A migráció `create or replace`-eli a két gate-függvényt — ez **MINDEN `research_*` tábla**
     írás/olvasás jogát érinti (nem csak a Map-et). Ezért kérlek olvasd át a fájlt, mielőtt lefuttatod.
   - Tartalmaz egy `research_member_accept(pid)` SECURITY DEFINER RPC-t (a meghívott a SAJÁT
     meghívóját fogadja el, szerepkör-módosítás nélkül).
   - Amíg nincs lefuttatva: a `👥 Megosztás` modalban a közreműködő-kezelés nem érhető el
     (a `members === null` ág üzenetet mutat), de a **jelenlét (presence) MÁR MOST MŰKÖDIK**
     (nem igényel migrációt) — a jobb-felső avatar-sor és a modal presence-sora élő.
   - Utána: a tulajdonos e-mail alapján meghívhat (Szerkesztő/Kommentelő/Megfigyelő), a meghívott
     elfogadja; a write-gate az összes `research_*` táblán egyszerre engedi a szerkesztőket.

   **Megjegyzés a jövőbeli Phase 2/3-hoz:** élő kurzorok, hozzárendelés, sign-off, suggesting/CRDT
   a draft-editorra — ezek még NINCSENEK megépítve (lásd `MAP_CANVAS_ROADMAP.md`).

## Edge-function deploy-ok (explicit jóváhagyás + megnevezés kell)

_(A lista alább bővül.)_

## Egyéb (megosztott DB-írás, konfig)

_(A lista alább bővül.)_

---

## Elkészült funkciók (kliens kész, migráció-függő)

_(A lista alább bővül.)_
