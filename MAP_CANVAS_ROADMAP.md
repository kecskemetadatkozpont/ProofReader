# Map / Canvas — Roadmap

> Forrás: a LumaLabs Infinite Canvas Dashboard áttekintése + saját javaslatok.
> Jelölés: ✅ kész · 🟡 részben · 🆕 új. Effort: 🟢 kicsi · 🟡 közepes · 🔴 nagy.

## ✅ Kész (autonóm munkamenet, 2026-07 — a teljes Luma-lista + Kooperatív Phase 1)

### Vászon-alapok
- [x] ✅ **Lebegő on-canvas kártya-modal** — a kijelölt kártya MELLETT lebeg (nem oldalsáv), a view-transzformból pozicionálva, ütközésnél balra fordul. *(edb4869)*
- [x] ✅ **Zoom%-kijelző + „illeszd a nézetbe" (⤢)** — élő nagyítás (kattints=100%) + a teljes gráf nézetbe illesztése. *(edb4869)*

### Asszisztens-dock
- [x] ✅ **Mód-választó (💬 Chat / ⚡ Akció) + 🎤 hangbevitel** — Web Speech (hu-HU) diktálás a dockba. *(edb4869)*
- [x] ✅ **Becsatolt-elem chip** + **cselekvés a kártyából** (protokoll-lépés) — korábbról.

### Kártya-szintű jelölők + akciók
- [x] ✅ **Lebegő selection-toolbar** a kijelölt kártya fölött (📌 kitűzés / 🙈 rejtés / ⚡ generálás / ⤓ export). *(79f4d22)*
- [x] ✅ **Per-node pin + rejtés** (📌 badge + kiemelő gyűrű; rejtett kártyák kikerülnek a gráfból + `🫥N` restore-panel) — `migration-70`. *(79f4d22)*

### Több-kijelölés + csoport-műveletek
- [x] ✅ **Shift-kattintás + marquee több-kijelölés** + csoport-mozgatás + csoport-sáv (📌/🙈/⤓/✕). *(e9e292f, marquee-leak fix 863ede8)*

### Csoportosítás / keretek
- [x] ✅ **Nevesített keretek / fázis-lane-ek** — world-térbeli, áthelyezhető/átméretezhető/átnevezhető/átszínezhető keretek, nem blokkolják a kártyákat — `migration-71`. *(2d5c06b)*
- [x] ✅ **Inline „✨ Generálj ide"** a keret címsorából nyíló input → keret-témájú utasítás az asszisztensnek. *(2d5c06b, reachability fix 863ede8)*

### Vászon-kommentek
- [x] ✅ **Kommentek/annotációk** — kártyához (💬N badge + thread) vagy szabad pozícióhoz (pin) tűzve; megoldva/válasz/törlés; `📋` összes-komment panel; a read-only konzulens is kommentelhet — `migration-72`. *(16b259b)*

### Lapok
- [x] ✅ **Több „Page" / mentett nézet** — „Teljes gráf" + nevesített viewport-lapok; `📌 Kurált` (csak kitűzöttek) lencse; `⟳` viewport-frissítés — `migration-73`. *(82d03b2)*

### Export + fókusz
- [x] ✅ **Térkép/kijelölés export** PNG-be (kliens-oldali canvas, CSP-safe). *(79f4d22)*
- [x] ✅ **Teljes-szélességű vászon + oldalsáv-összecsukás** + **animált adat-folyam élek** — korábbról.

### Kooperatív munka — Phase 1
- [x] ✅ **Jelenlét (presence)** — Realtime avatar-sor (ki nézi a térképet most), `👥 Megosztás` gomb. *(kliens-only, nincs migráció)* *(146f265)*
- [x] ✅ **Közreműködők + szerepkörök + Share-modal** — `research_project_members` + a write/read-gate átírása (elfogadott editor→írás, commenter/viewer→olvasás); e-mailes meghívás, elfogadás-banner, szerep-kezelés — `migration-74`. *(146f265)*

## ✅ Kooperatív Phase 2/3 — KÉSZ (2026-07-17)
- [x] ✅ **Élő kurzorok + kijelölés-broadcast** — Realtime broadcast a Map-csatornán; színes kurzorok
  név-címkével, a másik user kijelölése színes gyűrűvel; throttle + 6s prune; kliens-only. *(51ced20)*
- [x] ✅ **@mention + értesítés** a kommentekben — `@`-chipek (tagok+online) + `notifications` insert
  a megemlítetteknek (nincs migráció). *(518f7a4)*
- [x] ✅ **Hozzárendelés (assignee) protokoll-lépésekhez + sign-off** — felelős-avatar + ✅ badge a
  step-node-on, inspector-vezérlők (migr-75). *(ed13134)*
- [x] ✅ **Suggesting / track-changes** a draft-editorra — szekciónkénti javaslatok piros/zöld diff-fel,
  szerkesztő elfogad/elutasít, szerző visszavon (migr-76). *(3496d07)*

## ✅ Kooperatív Phase 4 — KÉSZ (2026-07-17)
- [x] ✅ **Follow-mode** — kattints egy online kollégára az avatar-sorban, és a viewport-ját követed
  (Realtime „view" broadcast; manuális pan/zoom kilép; „👁 Követed: X" sáv). *(a97ccbb)*
- [x] ✅ **Cursor-chat** — `💬` input → rövid üzenet a kurzorod mellett, a kollégák buborékban látják
  (élő gépelés, ~7s után elhalványul). *(a97ccbb)*
- [x] ✅ **Supervisor sign-off** — `research_step_signoff` SECURITY DEFINER RPC: a konzulens is
  aláírhat egy lépést általános írásjog nélkül (migr-77). *(05f7957)*

## ✅ Kooperatív Phase 5 — KÉSZ (2026-07-17)
- [x] ✅ **Élő közös draft-szekció-szerkesztés** — szekció-szintű inline szerkesztő a Writing panelben;
  a billentyűleütések valós időben broadcastolódnak (Supabase Realtime), a mentés a `research_drafts`-be
  ír; **per-szekció soft-lock** („🔒 X szerkeszti") a felülírás ellen; Mégse visszaállít. Nincs CRDT-függőség.
  Atomikus szekció-írás RPC-vel (migr-78) a cross-section lost-update ellen. *(d94be8f, 7b9aa27)*

## ✅ Prezi-mód (zoomolható munkafolyamat + storytelling) — KÉSZ (2026-07-17)
> Feltárás: 4-ágú design-workflow + szintézis → mockup-artifact (`prezi-mockups`). Fázisonként megépítve, mind reviewelve.
- [x] ✅ **Fázis 1 (D) — zoom-a-panelbe** — kártyába zoomolva (`◇ Belépés` / dupla-katt) a valódi munkafolyamat-panel
  a helyén nyílik; `flyTo` kamera-tween; `renderPanel` seam (a `RMAP_TYPE.tab` + `node.ref` alapján); `▶` Lap-túra. Nincs migráció. *(b644950, 142dbea)*
- [x] ✅ **Fázis 2 (C) — bemutató-mód** — `🎬` jelenetekből álló vezetett túra (felirat, előadói jegyzet, panel-megnyitás),
  lejátszó (←/→/Space), `🔴 Élő` megosztott bemutató (`story_beat` broadcast → követő-mód). `migration-79`. *(20097a5)*
- [x] ✅ **Fázis 2.5 (B) — „Rendezés fázisokba"** — `⌗` opcionális fázis-sávok + keretek (`node.ph`), megerősítéssel. *(196393a)*
- [x] ✅ **Fázis 3 (A) — szemantikus zoom (ZUI)** — LOD-szintek (`view.k`) + „arm-to-enter" (Enter a mélyre-zoomolt kártyába). *(2105a14, ba87d10)*

## 🚧 Gazdag/átméretezhető kártyák + 5. LOD (folyamatban, 2026-07-18)
> Feltárás: 3 mockup-artifact (gazdag kártyák · LOD-mátrix · átméretezés+5.LOD) + 2 design-workflow.
- [x] ✅ **P0+P1 — átméretezhető kártyák** — `research_map_layout.card_w/card_h` (migr-80); a kártya ◢ sarka húzható,
  a tartalom a mérethez igazodik (CSS `@container`, zoomtól függetlenül); lépés-progress/jóváhagyás, ábra-thumbnail,
  „◇ Belépés" a tier-ekben; `↺ Auto méret`. Graceful migráció előtt. *(6a2c132, 3682abd)*
- [x] ✅ **P2 — magasság-fit + gazdagabb inline vezérlők** — közös `ResizeObserver` (egy megfigyelő az összes kártyára)
  elkapja az ASZINKRON magasság-változásokat, amiket a deps-alapú mérés kihagy (főleg a később betöltődő ábra-thumbnail),
  így a no-overlap valós magassággal számol és a figure-kártyák nem csúsznak egymásra a kép megjelenése után; per-típus
  inline vezérlők a nagyra húzott kártyán: **cikk** szűrés-szegmens (✓ incl / ~ maybe / ✕ excl → `research_sources.screening`),
  **protokoll-lépés** státusz-léptetés (▶ Indít / ✓ Kész / ↺ Újranyit → `research_protocol_steps.status`) a jóváhagyás
  mellett; `doing`↔`running` konzisztencia a chip+progress-ben. Mind `canEdit`-gate + optimista + re-materializál. Nincs migráció.
- [x] ✅ **P3 — 5. LOD** — a teljes panel a kártyáról **beágyazott, nem-modal, átméretezhető ablakként**: a `⊞` gomb
  (selection-toolbar, csak `canEnter` típusnál) egy screen-space testvér-réteg ablakot nyit (`props.renderPanel(tab, fp)`
  valódi panellal), a kártya élő képernyő-rect-jéhez horgonyozva; húzható címsor + `◢` sarok-átméretezés (nyers screen-delta,
  zoomtól független); `MAX 3` ablak, z-rend a modal alatt (z 18+ vs `.rmap-focus` z 200); ha a horgony-kártya kicsúszik →
  él-chip vezeti vissza; `⛶` ablak→modal (Prezi) átjárás, `↗` a klasszikus fülre.
  **Adversarial review (9 lelet, 4 megerősítve, mind javítva):** a legmélyebb kockázat — a `renderPanel` N-szeres
  egyidejű mountolása — REFUTÁLVA (biztonságos: csak a `WritingPanel` oszt Realtime-topikot, az is kecsesen degradál).
  Javítva: (1) *ghost-ablak* — a törölt kártya ablakát a `winPruneKey` effekt kiszedi, a rejtett kártyáé
  visszaállítható sarok-chippé alakul (nem eszi meg a slotot); (2) z-rend — a `zTopRef` korlátlan számláló helyett
  `reZ` kompakt újrarangsorolás (20-tól), így ablak z sosem éri el a modal 200-at; (3) resize min-szélesség 300→320
  (a mount-kapuval egyezik, nincs panel-unmount+state-vesztés a holt sávban); (4) duplikált `sec-N` DOM-id — a TOC-ugrás
  a saját `.doc-embed`-jére szűkítve.

## 🚧 Interaktív élek (folyamatban, 2026-07-18)
> Feltárás: 3-ágú design-workflow (pragmatikus · szemantikus tudásgráf · storytelling) + kód-megalapozás → szintézis →
> interaktív mockup-artifact (`edge-mockup`). Az élek ma származtatott, néma provenance-vonalak; a terv elsőrangú,
> kijelölhető, tipizált, animált, címkézhető kapcsolatokká teszi őket.
- [x] ✅ **P0 — kijelölés + inspector + perzisztencia** — átlátszó „kövér” hit-path (`non-scaling-stroke`, 16px) minden
  zoomon; stabil `edge_key = from|to|kind`; kölcsönösen kizáró él/node-kijelölés; lebegő **él-inspector** (típus / szín /
  animáció / vonalstílus / nyílhegy / vastagság + `↺ Alaphelyzet`), az él felezőpontjához horgonyozva; 7 reláció-típus
  (Származás/Idézet/Bemenete/Támogatja/Ellentmond/Függőség/Kapcsolódik) look-presetként; animációk (Áramlás/Üstökös/
  Pulzus/Rajzolódás/Oda-vissza/Nyugodt) + reduced-motion guard; `research_map_edges` (**migration-81**) graceful
  betöltés + realtime self-echo guarddal; stabil React key = `edge_key`. ⚠️ **migration-81 alkalmazása manuális.**
- [x] ✅ **P1 — címke + inferRel + élő legenda + sebesség** — **címke-pill** az él felezőpontjánál (szerkeszthető az
  inspectorban, `research_map_edges.label`); **`inferRel()`** okos automatikus alapreláció a származtatott éleknek
  (cite→Idézet; adat/fájl/chat/ábra→lépés/ötlet = Bemenete; egyéb = Származás); **élő, szűrhető legenda** (bal-alul, a
  ténylegesen jelen lévő relációk szín+név+darabszám, szemre kattintva típusonként elrejthető — `hiddenEdgeTypes`,
  localStorage); **sebesség-csúszka** (per-él `--esp`, `research_map_edges.speed` — **migration-82**, graceful 2-szintű
  probe, a csúszka csak akkor jelenik meg). A rejtett-típusú kijelölt él inspectora + dim-je `hiddenEdgeTypes`-ra van kötve.
- [ ] 🔴 **P2** — kézi élek (link-mód húzással); érvelési lencse; Prezi story-fonál az élek mentén; fontosság-preset.

## Hátralévő (jövő) — Phase 6+
- [ ] 🔴 **Teljes karakter-szintű CRDT/Yjs** — egyidejű azonos-szekció gépelés valós idejű merge-dzsel.
  A jelenlegi soft-lock + LWW ennek a könnyűsúlyú, függőség-mentes alternatívája; a teljes CRDT nagy
  külső függőség (Yjs + sync-provider) egy build-lépés nélküli, vendorelt kódbázisban — külön dependency-döntés.

> ⚠️ **A `migration-70..74` alkalmazása manuális** — lásd `AUTONOMOUS_SESSION_MANUAL_STEPS.md`.
> A kliens minden funkciónál **kecsesen degradál**: a migráció előtt az adott UI egyszerűen nem jelenik meg.
