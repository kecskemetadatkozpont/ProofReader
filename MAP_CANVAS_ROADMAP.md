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

## 🚧 Radiális gyors-hozzáadó (bloom menü) — folyamatban, 2026-07-18
> Feltárás: 2-ágú design-workflow (interakció+mozgás · objektum-készlet+megvalósíthatóság) + kód-katalógus → szintézis →
> interaktív mockup-artifact (`radial-mockup`, favicon ✨). A lenti gombok helyett a kurzornál dobálhatsz objektumot.
- [x] ✅ **P0 — a gesztus + 3 szegmens** — **dupla-katt az üres vásznon** → a kurzor köré egy animált **kör-menü** „bloomol"
  (staggered rugó, R≈100px); a stage `onDoubleClick` (a node-ok dupla-kattja `stopPropagation`-öl → nincs ütközés; az `onDown`
  `if(e.detail>1)return` guard a 2. mousedown ellen). **click-to-open → hover → click-to-pick.** 3 capability-gate-elt
  szegmens: **Keret** (SVG keret-ikon, `frameCreate(wx,wy)` a kurzorra centrálva), **Ötlet** (`ideaAtPos` → `research_ideas`
  insert + `research_map_layout` pin `i<id>`-re + reload → ott terem), **Komment** (a meglévő composer a kurzornál).
  Pick-re: bezár + **drop-pulzus** a kurzoron. Mégse: scrim-katt / hub `✕` / Esc. Kézi clamp a viewportba. Reduced-motion
  guard. **2 új `useState`** (radial + drop) a guard-ok ELŐTT. A lenti `▦` gomb fallbacknek megmarad. Nincs migráció.
- [ ] 🟡 **P1** — ✨ Generálj ide (pont-anchor prompt); Ötlet inline átnevezés; 📎 Jegyzet/fájl szegmens; billentyűzet-fókusz.

## 🚧 Viewport-fit — lebegő elemek + kártyák a képernyőre (folyamatban, 2026-07-18)
> Feltárás: 3-ágú design-workflow (fitFloat primitív · widen-not-tall · kártya-cap) + kód-katalógus → szintézis →
> interaktív mockup-artifact (`fit-mockup`, a VALÓDI fitFloat-tal). A mai öt ad-hoc clamp helyett egy közös primitív.
- [x] ✅ **P0 — állítsd meg a kilógást** — közös `fitFloat(anchor, desired, vp, opts)` tiszta primitív (a `vp` explicit):
  a legtöbb helyet adó oldalt választja + MINDKÉT tengelyen a viewportba clampel margóval. Rákötve: node-inspector
  (`inspStyle`), selection-toolbar (`selToolStyle` — most már ALUL is clampel), él-inspector (`edgeInspEl` — a magic 244/320
  helyett), kontextmenü (`window`-viewport, fel/balra flip), komment-composer + thread (a `210*k`→`nodeW*k` hiba is javítva).
  **Kártya-sapka**: a kézzel átméretezett kártya render-időben ÉS resize közben a viewporthoz sapkázódik az aktuális
  zoomon (a `graph()`-geometria érintetlen). **Nulla új hook.** Magas panel egyelőre belül görget (a widen a P1).
- [x] ✅ **P1 — szélesíts, ne nyújts (él-inspector)** — az él-inspector magas nézetnél **2–3 oszlopra szélesedik** a magas
  görgető helyett: `fitFloat canWiden` + **flex `column-wrap` fix oszlopszélességgel** (a mért természetes magasság
  oszlopszám-független → nincs villódzás/RO-hurok); a fejléc + lábléc full-width. A magasság **mérve** (`measureNat` a
  gyerekek összegzésével — colW-invariáns), 1 `useState` (`floatNat`) + 1 `useRef`-tükör a guard-ok ELŐTT; első painten
  becslés, majd egy korrekciós frame. Belső görgetés csak a legvégső eset (`data-scroll`). (A node-inspector heterogén
  tartalma miatt ott a mérés+görgetés marad — a column-widen a P2-ben mérlegelendő.)
- [x] ✅ **P2 — resize-újra-illesztő + „Kártya a nézetbe"** — egy stage-`ResizeObserver` a böngésző/oldalsáv-átméretezésre
  újrarendereli a nézetet (`vpGen` bump) → minden float ÉS a kártya-sapka újra-illeszkedik (pan/zoom eddig is, de a puszta
  méret-változás nem); a selection-toolbar `⤢` gombja a kártyát a viewport ~90%-ára igazítja (`cardIntoView` → `flyTo`,
  **explicit — nincs auto-pan**). *(Elhalasztva: `autoFitCard` méret-illesztés — mérés-a-cél-szélességen nélkül pontatlan;
  bal-alsó panelek fitFloat-ja — már dokkoltak+maxHeight-esek; node-inspector column-widen — heterogén tartalom.)*

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
- [x] ✅ **P2 (részben) — kézi élek + érvelési lencse** — **drag-to-connect** (a preferált, természetes mód): a kártya
  fölé húzva a mutatót a szélein **csatlakozási pontok** (⚪ N/E/S/W) jelennek meg; egy pontból **kihúzva egy gumiszalag-élt**
  és egy másik kártyára **ejtve** létrejön a kézi kapcsolat (a cél-kártya kijelölődik húzás közben). Alternatíva/érintős **link-mód**: a selection-toolbar `🔗` gombja → felső
  banner („Kapcsolat innen: … — kattints a cél-kártyára", Esc/Mégse), a cél-kártyára kattintva **kézi él** jön létre
  (`manual=true` sor, alap-reláció *Kapcsolódik*, edge_key `from|to|manual`), amit a `graph()` beolvaszt az `E`-be és
  rögtön kijelöl (inspector → típus/stílus). A manuális él inspectorában `🗑 Kapcsolat törlése` (a sor törlése).
  **Érvelési lencse**: a legenda minden során egy `◎` „csak ez" gomb → a többi reláció-típus elrejtése (a `hiddenEdgeTypes`-ra
  épül), így egy kattintással előhívható pl. csak a *Támogatja*+*Ellentmond* váz; „mind" visszaáll.
- [x] ✅ **P2 zárás — Prezi story-fonál + fontosság-preset** — **story-fonál**: bemutató (🎬) közben az előző→jelenlegi
  **node-jelenet** közti él kigyúl és **üstököst** játszik le a narratíva útján (glow + vastagabb vonal + gyors comet;
  a `tour` állapotból származtatva, extra state nélkül; a rejtett-típusú él is látszik ilyenkor). **Fontosság-preset**:
  az él-inspector **1–5** gyors-beállítója egyszerre állítja a **tempót + vastagságot** (csak ha migration-82 fut, mert
  a sebesség onnan jön). **Ezzel az interaktív-él vonal (P0→P2) teljes.**

## 🚧 Keret-generálás → chat-akciók (2026-07-19)
> Feltárás: 2-ágú design-workflow (chat-akció-csipek · keret-hatókörű generálás) + kód-megalapozás → szintézis →
> interaktív mockup-artifact (`chatact-mockup`). **A probléma:** a keret „✨ Generálj ide" mezője eddig némán a
> research-CHAT edge-be tölcsérezte a szöveget → csak chat-válasz jött, **kártya nem**. A user kutatási-rés ötleteket
> kért egy kerethez, és csak szöveget kapott.
- [x] ✅ **P0 — döntés-csipek + ötlet-kártyák a keretbe** — a `frameGenerate` átírva: **nincs több néma chat-tölcsér**.
  Új folyamat: (1) a kérés visszhangzik a dockban; (2) **`classifyFrameIntent`** magyar kulcsszó-routing
  (rés/hiány/gap → gap · ötlet/kapcsolódó → suggest · protokoll/lépés → protocol · irodalom/study → study · egyéb → chat);
  (3) az AI-buborék alá **4 kattintható döntés-csip** kerül (**✦ Ötlet-kártyák ide** [elsődleges], **① Csak egyet**,
  **🧪 Protokoll a keretbe**, **💬 Csak beszéljük meg**), az intent az elsődlegest promotálja. Az **✦** a **meglévő
  strukturált** `research-ai` **gap** generátort hívja (novelty-scoring + dedup), az új ötleteket a **`placeInFrame`** a
  keret világ-koordinátás határain belülre rácsozza (auto-**nő** a keret, ha nem férnek), optimista append a 24-es
  reload-cap felett is; **pulzáló kiemelés** az új kártyákon (`.rmap-justplaced`), **toast + ↩ Visszavonás**-csip
  (`undoPlaced` → törli az ötleteket+layoutot). A dock minden üzenete hordozhat csip-sort (`dMsgs[i].actions`,
  `.done` → egyetlen „✓ Kész"); **nincs új hook a guard-ok után** (a csip-adat az üzenetbe ágyazva). A protokoll-út
  destruktív → `window.confirm`. Az utó-csipek: **➕ Még · 🧪 Protokoll · ↩ Visszavonás**.
- [ ] ⏳ **P1 — grounded suggest + strukturált id-k + inline confirm** — a gap helyett **suggest** a keret témájára
  alapozva; az edge adjon vissza **id-ket** (ne created_at-diff kelljen); a protokoll/study kereten-belüli elhelyezése +
  **inline** megerősítés a natív `confirm` helyett; ha a chat gépi `ideas` blokkot ad → **exact** címekkel kártyázás.

## 🚧 Kutatási rés-elemző (Research Gap Analyser) — 2026-07-19
> Feltárás: 2-ágú + kód-megalapozás **research + design workflow** (rés-taxonómia lekutatva: Miles 2017 + 3ie/Campbell
> evidence-gap-map) → szintézis → interaktív mockup (`gap-analyser`, favicon 🕳️). **A hiányzó láncszem:** a klasszikus
> workflow-ban nem volt dedikált rés-elemzés — a `gap` edge csak tipizálatlan ötlet-jelölteket dobott a listába.
- [x] ✅ **P0 — klasszikus-workflow „🕳️ Rések" fül** — a rés **egy `research_ideas` sor** (`source='gap'`) + 3 additív
  oszlop (**migration-83**: `gap_type`, `evidence jsonb`, `addressed_by_idea_id`) → a Map-materializáció, layout,
  `placeInFrame`/undo és RLS **öröklődik** (nincs külön tábla). Új edge **`action='gap_analyze'`** (a régi `gap`
  érintetlen): 7-típusú taxonómia, `source_ref` index-validálva, `{ok,count,ideas}` — oszlop-fallbackkel pre-migration is
  működik. **`GapPanel`** al-fül (a `study`-mintára, az Irodalom után, NEM életciklus-lépés → nem töri a Stepper
  index-kötését): önállóan tölt (graceful oszlop-probe), rangsorolt rés-kártyák (típus-badge, újdonság-mérő,
  bizonyíték-chipek, „miért rés", következő lépés), **típus-legenda szűrő**, akciók (**→ Ötletté alakítás** [a résből
  ötlet lesz, az Ötletek közé], 🔍 Study, ✕ Elvetés), üres/degradált állapot. Bekötve: nd stageNav + klasszikus Stepper
  gap-sub (`i===2`), `panelForTab` + content-switch, a régi IdeasPanel gap-gomb **átirányítva** a fülre (`onGoGap`).
  **migration-83 + `research-ai` deploy manuális; a kliens addig gracefully degradál.**
- [x] ✅ **P1 — Térkép-objektumok** — `RMAP_TYPE.gap` (🕳️ „Kutatási rés") + `.t-gap` CSS (szaggatott rose bal-szegély);
  `graph()` a `source==='gap'` ötleteket **külön gap node**-ként materializálja (id marad `i+id` → layout/élek/komment
  változatlan), m = {Típus, Újdonság, Bizonyíték: N forrás}; **élek** (node-létezésre kapuzva, nincs lógó él):
  **forrás→rés** (az `evidence[].source_id`-ből, ha a cikk a `topSrc`-ben van + `litOpen`) és **rés→ötlet**
  (`addressed_by_idea_id`-ből). A Map-betöltő idea-selectje graceful oszlop-fallbackkel bővült; `EMBEDDABLE.gap` +
  `focusPropsFor` → `focusGapId` (a gap node-ba belépve a GapPanel nyílik). A **GapPanel „→ Ötletté alakítás"** most
  ÚJ ötletet hoz létre + **linkeli** (`addressed_by_idea_id`) → a rés „Előléptetve" marad (feeds a rés→ötlet él). Az edge
  `gap_analyze` most `source_id`-t is tesz az `evidence`-be (a forrás→rés élhez) — **edge-redeploy kell hozzá**. Adversariális
  review után. *(Elhalasztva P1.5-re: rose rés-fészek keret futásonként + újdonság-gyűrű a node-on.)*
- [x] ✅ **P2 — keret-scoped dock (#2)** — `boundFrame` useState (a guard-ok előtt); **`💬` gomb a keret-fejlécen** →
  a dock chat a kerethez **kötve** (sel/msel/selEdge törölve + dock nyílik), scope-**pill** a dock-fejlécen (✕ leválaszt);
  a dockba írt parancs a `dkSend`-ben **átirányítva** → `frameGenerate(boundFrame, txt)` → döntés-csipek → `placeInFrame`
  (a MÁR kész chat-action gépezetet használja: undo/pulzus/toast változatlan). A törölt-keret eset unbind + normál chatre
  esik vissza; az override-hívók (chat-fallback) nem irányítódnak át (nincs rekurzió). Placeholder-csere kötött állapotban.
- [x] ✅ **P3 — evidence-gap Mátrix + P1.5** — **Mátrix**: a GapPanel `Lista|Mátrix` váltója; új edge `action='gap_matrix'`
  (`askClaudeMatrix` → `{rows,cols,cells}`, method×domén rács) igény szerint lekérve; üres (0) cella = rés (szaggatott rose).
  Graceful: túl kevés forrás → „none"; edge nélkül → „error" + ↻. **P1.5**: **újdonság-gyűrű** a gap node-on (SVG ív,
  `n.ref.novelty`) + **rose „rés-fészek" keret** minden elemzési futásból (`placeGapsInNewFrame` → `research_map_frames`
  + `research_map_layout` upsert; frames+layout realtime → élőben megjelenik; csak az edge-redeploy utáni futásoktól, mert
  a keret a visszaadott id-kből épül). ⚠️ **Deploy-sorrend:** a P3 frontend push CSAK az edge-redeploy UTÁN — különben
  a Mátrix megnyitása a régi edge-en mellékhatásként gap-ötleteket írna (write-on-view). Adversariális review után.
- [x] ✅ **P4 — Mátrix-akció + rés-fészek ütközés** (kliens-oldali, nincs edge/deploy): **P4.1** — egy üres (0) Mátrix-cellára
  kattintva **rés jön létre** az adott módszer×domén metszethez (`createGapFromCell` → `research_ideas` insert
  `gap_type='population'`, `evidence:[]`; csak szerkesztőnek, `cellBusyRef` szinkron guard a dupla-katt ellen; utána
  Lista + reload + toast). A kattintható gap-cellák `＋`-t mutatnak, hover-kiemeléssel. **P4.2** — a rés-fészek keret a
  **meglévő keretek ALÁ** kerül (`research_map_frames` y/h lekérdezés → `maxBottom+28`), a P3 Int32-jitter kivéve.
  Adversariális review után.
- [x] ✅ **P5 Tier 1 — rés-workflow finomítások (kliens-oldali)** — **P5.1** „Study a résből" (a 🔍 gomb valódi SR-tanulmányt
  indít a résből: `startStudyFromIdea(gap)`, a rés `idea_id`-vel linkelve, a study kérdése a rés javasolt kérdése);
  **P5.2a** szerkeszthető rés-típus (legördülő a 7 típusból a kártyán; optimista + hibánál visszaáll); **P5.3** Markdown
  **export** (rangsorolt rés-lista + mátrix; pipe/újsor escapelve, `cells`-guard); **P5.4b** dedup-jelzés („⚠ hasonló #N"
  konzervatív Jaccard-heurisztika, nem destruktív). Review: 1 minor javítva (export `cells`-guard + escape).
- [x] ✅ **P5 Tier 2 — AI-cellagap + konzulensi jóváhagyás** (deploy/migráció-igényes, gracefully degradál):
  **P5.2b** — új edge `action='gap_cell'` (`askClaudeCell` → egy tipizált rés a cellához) + a `createGapFromCell` **előbb az
  edge-et** hívja, hiba/nem-támogatott esetben a **sablonra** esik vissza (a jelenlegi allow-listás edge-en `gap_cell`→400→sablon,
  nincs write-on-view). **P5.4a** — **migration-84** (`research_ideas.gap_important` + `research_gap_set_important` SECURITY
  DEFINER RPC, admin/writer/**supervisor**) + GapPanel: `isSupervisor` (RPC-ből), `impCap` (gated `gap_important` fetch), a
  kártyán **⭐/☆** kapcsoló (szerkesztő VAGY konzulens; RPC + editor-fallback), a fontos rések **elöl** + „important" kiemelés.
  Adversariális review után. **⚠️ Aktiváláshoz: `supabase functions deploy research-ai` (gap_cell) + `migration-84` (⭐).**
  Addig graceful: cellagap = sablon, ⭐ rejtve.

## 🚧 Keretbe csoportosítás (frame-as-group) — 2026-07-19
> Feltárás: 2-ágú (csoportosítás-UX · keret-mint-konténer) + kód-megalapozás design-workflow → szintézis → interaktív
> mockup (`group-frame-mockup`, favicon ▢). **A kérés:** több kártya kijelölése → egy gomb keretet húz köréjük, és a
> keretet fogva az egész csoport mozog. **Kulcs-döntés: tartalmazás (center-inside), NINCS séma/migráció** — a keret marad
> tiszta `research_map_frames` téglalap.
- [x] ✅ **P0 — csoportosítás** — **`▢+`** gomb a meglévő multi-select group-toolbaron (`.rmap-groupbar`, csak >1 kijelöltnél;
  `framesCap && canEdit`-gated) + **⌘/Ctrl+G** (saját useEffect, `[msel,framesCap,focus,tour]` deps, typing-guard + preventDefault,
  a guardok ELŐTT). `groupIntoFrame()`: méret-tudatos befoglaló doboz (`nodeW/nodeH`, pad 24 / fejléc 44), `FRAME_COLORS` rotáció,
  `research_map_frames` insert + `setFrames` dedup + toast, `setMsel({})`. A 🗑 tooltip: „Keret törlése (a kártyák maradnak)" —
  a szétbontás ingyen (nincs tagság).
- [x] ✅ **P1 — keret-mint-konténer mozgatás** — a `startFrameDrag` move-ága most a benne lévő kártyákat is viszi: mousedownkor
  **tag-snapshot** (`inFrame` = center-inside, `!mapHidden`) + base-pozíciók a `frdrag` refre; a mozgásban a **meglévő `gLive`**
  élő-renderre kötve (`setGLive({dx,dy,base})` → a `graph()` 5184-es sora tolja a kártyákat, nulla új render-kód); droppoláskor
  `framePatch` + `setLayout` batch + `persistPos` tagonként (a `setGLive(null)` ELŐTT — nincs snap-back), + realtime echo-guard a
  vitt kártyákra. **A resize semmit sem mozgat.** A rés-fészek + fázis-lane keretek **öröklik** a konténer-mozgatást. Adversariális review után.
- [x] ✅ **P1.5** — **shift = kitűzött kihagyása** (`!(e.shiftKey && n.mapPinned)` a carry-szűrőben) · **fejléc-hover előnézet**
  (`hovFrame` useState + a header onMouseEnter/Leave → a mozgó kártyák `.rmap-carry-preview` szaggatott pulzus, reduced-motion-guard;
  a húzás alatt elnyomva) · **dedup-guard** (ha már van keret e bbox köré [±10px] → `framePatch` frissítés + toast, nem új keret).
  Adversariális review után.

## Hátralévő (jövő) — Phase 6+
- [ ] 🔴 **Teljes karakter-szintű CRDT/Yjs** — egyidejű azonos-szekció gépelés valós idejű merge-dzsel.
  A jelenlegi soft-lock + LWW ennek a könnyűsúlyú, függőség-mentes alternatívája; a teljes CRDT nagy
  külső függőség (Yjs + sync-provider) egy build-lépés nélküli, vendorelt kódbázisban — külön dependency-döntés.

> ⚠️ **A `migration-70..74` alkalmazása manuális** — lásd `AUTONOMOUS_SESSION_MANUAL_STEPS.md`.
> A kliens minden funkciónál **kecsesen degradál**: a migráció előtt az adott UI egyszerűen nem jelenik meg.
