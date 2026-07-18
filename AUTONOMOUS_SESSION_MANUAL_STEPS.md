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
   - **Tartalmaz egy `rp_guard_owner` BEFORE UPDATE triggert** a `research_projects`-en: mivel az
     editor mostantól író, e nélkül egy elfogadott editor a `owner_id`-t magára írhatná és
     átvehetné a projektet. A trigger csak a jelenlegi tulajdonosnak/adminnak engedi az
     `owner_id`/`student_id` módosítását (az adversariális review találta meg — CONFIRMED, high).
   - Amíg nincs lefuttatva: a `👥 Megosztás` modalban a közreműködő-kezelés nem érhető el
     (a `members === null` ág üzenetet mutat), de a **jelenlét (presence) MÁR MOST MŰKÖDIK**
     (nem igényel migrációt) — a jobb-felső avatar-sor és a modal presence-sora élő.
   - Utána: a tulajdonos e-mail alapján meghívhat (Szerkesztő/Kommentelő/Megfigyelő), a meghívott
     elfogadja; a write-gate az összes `research_*` táblán egyszerre engedi a szerkesztőket.

6. **`backend/migration-75-step-assignee-signoff.sql`** — protokoll-lépés felelős + sign-off
   (`research_protocol_steps.assignee_id / signed_off_by / signed_off_at`). Nincs RLS-változás
   (a lépés a protokoll→projekt jogán íródik). Amíg nincs lefuttatva: a Map step-node-jain nem
   jelenik meg felelős-avatar / ✅ sign-off; utána az inspectorban felelős-választó + „Jóváhagyom".

7. **`backend/migration-76-draft-suggestions.sql`** — draft „suggesting mode"
   (`research_draft_suggestions`). RLS: olvasás=olvasók; INSERT=bármely olvasó (author=self, a
   read-only konzulens is javasolhat); accept/reject/withdraw=szerző vagy szerkesztő. Amíg nincs
   lefuttatva: a Writing panel szekcióin nem jelenik meg a `💡 Javaslat` UI; utána szekció-szintű
   javaslatok piros/zöld diff-fel, szerkesztő „✓ Elfogad" → beírja a `research_drafts.sections`-be.

   **PHASE 2/3 MEGÉPÜLT (2026-07-17):** élő kurzorok + kijelölés-broadcast (kliens-only, nincs migráció),
   `@mention` + értesítések a kommentekben (a meglévő `notifications` táblát használja, nincs migráció),
   lépés-felelős + sign-off (migr-75), draft suggesting mode (migr-76). A **Phase 3-ból CRDT-alapú**
   valós idejű együtt-gépelés szándékosan kimaradt (suggesting mode a könnyűsúlyú alternatíva).

8. **`backend/migration-77-supervisor-signoff.sql`** — konzulensi sign-off. `research_step_signoff(step_id, clear)`
   SECURITY DEFINER RPC: editor/owner/admin **VAGY konzulens** aláírhat egy lépést anélkül, hogy a
   konzulens általános írásjogot kapna (egyébként read-only marad). `research_is_supervisor(pid)` segéd.
   Amíg nincs lefuttatva: a konzulens nem tud sign-off-olni (editor a migr-75 közvetlen úton igen).

   **PHASE 4 MEGÉPÜLT (2026-07-17):** follow-mode (kolléga viewport-jának követése) + cursor-chat
   (kliens-only, nincs migráció) + konzulensi sign-off (migr-77).

9. **`backend/migration-78-draft-set-section.sql`** — `research_draft_set_section(d_id, s_key, s_latex)`
   SECURITY DEFINER RPC: EGY szekciót módosít a `research_drafts.sections` jsonb-ben, **sor-zárolással**
   (`select … for update`), hogy a párhuzamos szekció-mentések ne írják felül egymást (a teljes-tömb
   visszaírás lost-update-jét szünteti meg — az adversariális review találta meg, CONFIRMED major).
   Amíg nincs lefuttatva: a kliens a teljes-tömb írásra esik vissza (graceful).

   **PHASE 5 MEGÉPÜLT (2026-07-17):** élő közös draft-szekció-szerkesztés (Supabase Realtime + per-szekció
   soft-lock, nincs CRDT-függőség) + a fenti atomikus szekció-írás (migr-78). A **teljes karakter-szintű
   CRDT/Yjs** (egyidejű azonos-szekció gépelés valós idejű merge-dzsel) továbbra is szándékosan kimaradt
   (Phase 6 — nagy külső függőség, külön dependency-döntés).

10. **`backend/migration-79-map-paths.sql`** — Prezi-mód **bemutatók** (story paths): `research_map_paths` tábla.
    RLS/realtime a `research_map_pages`-ből klónozva (olvasás=olvasók, írás=szerkesztők). Amíg nincs lefuttatva:
    a `🎬` bemutató-kezelő NEM jelenik meg, DE a `▶` Lap-alapú gyors-túra migráció nélkül is működik.

    **PREZI-MÓD MEGÉPÜLT (2026-07-17) — zoomolható munkafolyamat + storytelling a Map-en:**
    - **Fázis 1 (D):** kártyába zoomolás → a valódi munkafolyamat-panel a helyén nyílik (`◇ Belépés` / dupla-katt);
      `flyTo` kamera-tween; `▶` Lap-alapú túra. **Nincs migráció.**
    - **Fázis 2 (C):** `🎬` bemutató-mód — jelenetekből álló vezetett túra (felirat, előadói jegyzet, panel-megnyitás),
      lejátszó, `🔴 Élő` megosztott bemutató. **`migration-79` kell** (a UI addig graceful-rejtett).
    - **Fázis 2.5 (B):** `⌗` „Rendezés fázisokba" (opcionális, megerősítéssel). **Nincs migráció.**
    - **Fázis 3 (A):** szemantikus zoom (LOD) + „arm-to-enter" (Enter a mélyre-zoomolt kártyába). **Nincs migráció.**

11. **`backend/migration-80-card-size.sql`** — kézzel átméretezhető kártyák: `research_map_layout.card_w/card_h`
    (NULL = auto). RLS változatlan. Amíg nincs lefuttatva: a kártyák sarok-fogantyúja NEM jelenik meg, minden
    kártya a mai módon méreteződik (graceful, a load-probe 3-szintű). Utána: a kártya sarkát (◢) húzva átméretezhető,
    és a tartalom a mérethez igazodik (CSS `@container`) — pl. a lépés-kártyán progress + jóváhagyás, az ábra-kártyán
    thumbnail, ha elég nagyra húzod; `↺ Auto méret` a jobb-katt menüben visszaáll. (Ez a „gazdag kártya + 5. LOD"
    irány **P0+P1** része; a P2 finomítás + a P3 beágyazott panel-ablak még jön.)

12. **`backend/migration-81-map-edges.sql`** — interaktív élek: `research_map_edges` tábla (per-él stílus-override +
    kézi élek), kulcs `edge_key = from|to|kind`. RLS + realtime a `migration-79` mintájára (`research_can_read/write_project`).
    Amíg nincs lefuttatva: az élek NEM kijelölhetők, nincs inspector/override — az élek **pontosan a maiak** (graceful,
    3-szintű probe, `edgesCap=false`). Utána: az élre kattintva megnyílik az **él-inspector** (reláció-típus / szín /
    animáció / vonalstílus / nyílhegy / vastagság + `↺ Alaphelyzet`), a stílus perzisztál és realtime szinkronizál.
    (Ez az „interaktív élek" irány **P0** része; a P1 címke+legenda+inferRel és a P2 kézi élek+story-fonál még jön.)

## Edge-function deploy-ok (explicit jóváhagyás + megnevezés kell)

**NINCS** — ebben a munkamenetben egyetlen edge-function sem változott, deploy nem szükséges.
Minden funkció kliens (research.jsx / Research.html) + Supabase-tábla-migráció.

## Egyéb (megosztott DB-írás, konfig)

**NINCS** kötelező setup-lépés. Megosztott DB-be írás csak akkor történik, ha valaki ténylegesen
használja az új funkciókat (keret/komment/lap/tag/meghívó létrehozása) — ezek RLS-gated felhasználói
műveletek.

---

## Összefoglaló — mit építettem (teljes Luma-lista + Kooperatív Phase 1)

Minden be van commitolva a `main`-re és deploy-olva (GitHub Pages).

| Commit | Tartalom | Migráció |
|---|---|---|
| `edb4869` | Lebegő kártya-modal + zoom%/fit-to-view + dock mód-választó & hangbevitel | — |
| `79f4d22` | Per-node pin/rejtés + selection-toolbar + PNG-export | **70** |
| `e9e292f` | Több-kijelölés (shift/marquee) + csoport-műveletek + review-fixek | — |
| `2d5c06b` | Nevesített keretek (fázis-lane) + inline „generálj ide" | **71** |
| `16b259b` | Vászon-kommentek/annotációk | **72** |
| `863ede8` | Fix: marquee-listener-leak + keret inline-generate elérhetőség | — |
| `82d03b2` | Lapok / mentett nézetek (kurált lencse) | **73** |
| `146f265` | Kooperatív Phase 1: presence + közreműködők/szerepek + Share-modal | **74** ⚠️ |
| `bfd7210` | Biztonsági fix: `rp_guard_owner` trigger (editor→owner eszkaláció) a migr-74-ben | (74) |
| `51ced20` | Phase 2: élő kurzorok + kijelölés-broadcast | — |
| `518f7a4` | Phase 2: `@mention` + értesítések a kommentekben | — |
| `ed13134` | Phase 2: lépés-felelős + sign-off | **75** |
| `3496d07` | Phase 3: draft suggesting mode (javaslatok szekciónként) | **76** |
| `a97ccbb` | Phase 4: follow-mode + cursor-chat | — |
| `05f7957` | Phase 4: konzulensi sign-off (RPC) | **77** |
| `d94be8f` | Phase 5: élő közös draft-szekció-szerkesztés (soft-lock) | — |
| `7b9aa27` | Fix: atomikus szekció-írás RPC (cross-section lost-update) | **78** |
| `c4a20f9` | Típus-szűrő (👁): objektum-típusok ki/be a térképen | — |
| `b644950`.. | **Prezi-mód** F1 (D): zoom-a-panelbe + flyTo + Lap-túra | — |
| `20097a5` | Prezi-mód F2 (C): bemutató-mód (jelenetek, előadói, élő) | **79** |
| `196393a` | Prezi-mód F2.5 (B): „Rendezés fázisokba" | — |
| `2105a14` | Prezi-mód F3 (A): szemantikus zoom + arm-to-enter | — |

**Teendőd:** a `migration-70 … 74` már lefutott (2026-07-17, smoke-tesztelve). Már csak a
**`migration-75` és `migration-76`** van hátra — futtasd le a Supabase SQL editorban (ref
`jokqthwszkweyqmmdesn`). Ezek nem biztonság-érzékenyek (a 75 csak oszlopokat ad, a 76 új tábla saját
RLS-sel). Amíg nem futnak: a lépés-felelős/sign-off és a draft-javaslatok UI nem jelenik meg
(graceful) — minden más él, beleértve az **élő kurzorokat és a `@mention`-öket** (ezek migráció nélkül).
