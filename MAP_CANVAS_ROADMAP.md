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

## ✅ MD-részlet → chat-kontextus — 2026-07-20
> User: „ha az md-olvasóban kijelölök egy szövegrészletet, a chat-asszisztens érzékelje és kontextusként emelje be — hogy az adott fájlon belül az adott részlettel dolgozzon".
- [x] ✅ **Kijelölés → chat-kontextus (review 0 találat)** — a fájl-előnézet (`.rmap-t-pv`, csak md/text/csv) `onMouseUp`-ja → `pvSelUp(n)`
  (1ms után `getSelection`, >3 karakter → lebegő gomb a kijelölésnél); a **„✚ Chat-kontextus"** gomb (`pvAddSnippet`) a részletet
  (`{text,file,fileId}`) a `dSnips` listába teszi + megnyitja a dockot. A dock **snippet-chipeket** mutat (`✂ fájl: „részlet…"`, ×-eltávolítható,
  a `rmap-dock-att` újrahasznosítva). A `dkSend` a promptba emeli: `[KIJELÖLT SZÖVEGRÉSZLET(EK) — a felhasználó ezeken a részleteken akar
  dolgozni…]` (a kártya-kontextus mintája), csak normál gépelt turn-nél (isOv/boundFrame nem), küldéskor törli. Bounded (capture 4000 / prompt 2000 kar).
  2 új useState (`dSnips`/`pvSel`) a guardok előtt; a meglévő selection-popup + attach-chip minták újrahasznosítása. **NINCS migráció/edge, nincs CSS-változás.**

## ✅ Fájl-előnézet a kártyákon (P0+P1) — 2026-07-20
> User: „a fájlok preview-jai a kártyákon, ha elég nagy a kártya — md/pdf/szöveg/kép/videó, amit a fájl igényel". Design: `card-file-preview-mockup` (🖼️, ① előnézet a kártya alján + P0/P1 jóváhagyva).
- [x] ✅ **Méret-alapú, típus-illő előnézet + lusta betöltés** — a `richTier(n)` új `.rmap-t-pv` blokkja (`t:file/section/review`, `@container min-width:240 & min-height:150`,
  a figure-tier mintája): **md**→`mdHtml(stripFiles(txt))` · **CSV/TSV**→tábla (delimiter a kiterjesztésből) · **szöveg/kód**→`<pre>` · **kép**→`<img loading=lazy>` ·
  **videó**→`<video controls preload=metadata>` · **audió**→`<audio controls>` · **PDF**→`<iframe>`. **Lusta betöltés** (csak ha `n._h≥150 & _w≥240`, egyezik a
  `@container`-rel): `fileKind(path)` típus; `ensureFileText(f)` (DB `content` vagy uploaded-blob signed-URL→fetch.text, cache `fileText` state, 20k cap); a
  bináris a meglévő `ensureFigUrls`/`figUrls`-t használja (createSignedUrls, cache). A pán/zoom nem tölt újra (cache-guard); LOD-0 far-zoom cap rejti.
- [x] ✅ **Review-fixek** (a verify session-limitbe futott → a verifikálatlan találatok saját elbírálással): **#4** a preview-blokk `onMouseDown`-t is elnyeli
  (scroll/szövegkijelölés/media-vezérlők a kártya-drag helyett; a kártya a fejlécből mozgatható); **#5** `.tsv`→tab-delimiter. Elfogadott/CONFIRM: ensureFigUrls
  hibás-URL redundancia (figure-tier paritás), hook-safe, tier-gate egyezés. PDF-iframe: inline signed-URL-nél működik (nem crashel). **NINCS migráció/edge.**
- [x] ✅ **Utólagos bug-fix (a #4 regressziója):** a nagy md-kártya előnézetére kattintva NEM jelölődött ki a kártya (a mousedown-stop miatt), így nem
  csatolódott be a dock-chatbe. **Fix:** a preview-blokkra `onClick` → `setSel(n.id)` (a mousedown/wheel-stop marad a scroll/kijelölés/media-vezérlőkhöz).

## ✅ Kártya-akciók a toolbarba — a lebegő inspector opt-in-né — 2026-07-20
> User: „a kártyára kattintva felugró lebegő modal gombjait inkább a toolbarba, ikonként, a kártyák felett". Design: `card-toolbar-actions-mockup` (🧰, 3 verzió → ① csak toolbar + ⓘ igény szerint jóváhagyva).
- [x] ✅ **Akciók → toolbar-ikonok + opt-in modal** — a `.rmap-seltool` (magnify-dock) új ikonjai: **◇ Belépés** (`enterNode`, `canEnter`-gated),
  **✎ Szerkesztés** (`openEdit`, `editSpec`-gated), **⧉ Fülön** (`onGoTab`), **🌐 Forrás** (`window.open`, ha `sn.ref.url`), **ⓘ Részletek**
  (togglel `inspOpen`). A ⚡ továbbra is a generálás-menüt (genActions+regen), a 🗑 a törlést. A lebegő `.rmap-insp-float` mostantól
  csak **`sn && inspOpen`**-re jelenik meg (nem magától); a `rmap-insp-acts` gomb-blokk + a „Mit tehetsz innen" genActions-szekció
  **törölve** (redundáns a toolbarral/⚡-menüvel); a modal már **csak részletek** (metaadat/ábra/step-felelős+sign-off/finomító-chat).
  `inspOpen` useState + `useEffect([sel])` reset (a guardok előtt) → új kijelölés = csak toolbar. A modal **×** most `setInspOpen(false)`
  (a kártya kijelölve marad). **Adversariális review: 0 találat.** **NINCS migráció/edge.**

## ✅ Térkép-integrált bal File Explorer (fájl ↔ kártya) — 2026-07-20
> User: „a Térképről is elérhető File Browser, ahol látszik mi jött létre / mi lett feltöltve / hova, és fájlra kattintva highlight-olja a kártyát" + összecsukható. Design: `map-filebrowser-mockup` (📂, 3 elrendezés → ① bal explorer + P2 jóváhagyva).
- [x] ✅ **Bal Explorer + fájl↔kártya + P2 + összecsukhatóság** — a `.rmap-wrap` (már flex) első flex-gyermeke egy **összecsukható**
  `.rmap-explorer` panel (🗂 Fájlok fejléc + **‹** összecsuk; `fbOpen` state localStorage-perzisztens, default zárt; toolbar **🗂**
  gomb is toggle) — a stage magától szűkül. A panel a meglévő **`SessionFileBrowser`** (704) újrahasznosítása, kibővítve:
  **on-map pötty** (`mapNodeId(f)`: `writing/·studies/`→`w`+id, egyébként `f`+id, csak ha `g.by[nid]` létezik → tömör ●/üres ○),
  **kattintás→highlight** (`onLocate`→`setSel`+`cardIntoView`), **P2 kétirányú** (`locatedFileId`: a kijelölt fájl-kártya `ref.id`-ja
  → a böngésző az adott `[data-fid]` sorra görget+kiemel, `fbRootRef`-fel THIS-instance-scope-olva). A dock Files-fül is megkapta.
- [x] ✅ **Review-fix (MAJOR):** az explorer jobbra tolta a stage-et, de a kártya-relatív overlay-ek (seltool, él-címkék, él-inspector,
  node-inspector) a `.rmap-wrap`-hez horgonyzottak stage-lokális koordinátákkal → nyitott panelnél elcsúsztak. **Fix:** új
  `.rmap-stage-col` (position:relative, flex:1) wrapper a [stage…insp-float] köré (az explorer testvére) → minden a stage origójához
  igazodik. Verifikáció paren-mélység-trace-szel: a col pontosan a stage+overlay-eket öleli, az `editing`/`windows`/`focus`/`menu`
  kívül marad, 0 regresszió. **NINCS migráció/edge.**

## ✅ Kártya-törlés + P2-polish — 2026-07-20
> User: „lehessen törölni kártyákat amiket a User úgy dönt" + dock kijelölés→ötlet + böngésző-törlés/átnevezés frissítse a térképet.
- [x] ✅ **Kártya-törlés (destruktív, confirm-gated)** — `nodeDelete`/`nodesDelete`/`delOneNode`/`nodeDeletable` (guardok előtt, plain fv-ek):
  `DEL_BY_TYPE` típusonként a helyes táblát törli (`idea/gap→research_ideas`, `step→research_protocol_steps`, `venue→research_journal_picks`,
  `dataset→research_datasets`, `file/section/review-fájl→research_files`, `chat→research_chats`, `figure→research_figures`) `n.ref.id` szerint,
  + a storage-blob + a `research_map_layout` sor törlése, majd `setSel/setMsel/setBump`. **Biztonságos scope:** a megosztott/pipeline-adat
  (`paper→research_sources`, `srq`, `sreview`) és az **összesítő** node-ok (`lit`/`sr`, nincs `ref.id`) **NEM törölhetők** (`nodeDeletable` false →
  nincs 🗑, csak 🙈 rejtés). **FK-graceful** hibaüzenet. Gombok: **🗑 a kijelölés-toolbaron** (`.rmap-dbtn-danger`) · **🗑 Törlés az inspectorban** ·
  **🗑 a groupbaron** (több kijelölt, egy confirm, `Promise.all`, részleges-hiba jelentés). A groupbar ✕ átnevezve „Kijelölés megszüntetése".
- [x] ✅ **P2-polish** — **(a)** böngésző `del/renameFile/moveTo` → `props.onChanged()` a `load()` után; a dock `onChanged: setBump`-ot ad → a fájl
  törlése/átnevezése a Térképet is frissíti (nincs loop, mert `load()` nem hív `onChanged`-et; az Idea-chat változatlan). **(b)** **dock kijelölés→ötlet:**
  `dkSelUp` (msgs `onMouseUp`) → lebegő `.sel-idea-btn` „✚ Ötletnek" → `dkSelToIdea` insert `research_ideas` + `setBump`; a gomb `dkOpen && dkTab!=='files'`-re kapuzva.
- **Adversariális review (4 ágens): 1 minor javítva** — a storage-blob törlése nem futott file/review/section-nél, mert a két `research_files` loader-select
  nem hozta a `storage_path`-ot → árva blob; **fix:** `storage_path` hozzáadva mindkét selecthez. (1 kozmetikai elvetve, mégis lezárva a render-kapuval.) **NINCS migráció/edge.**

## ✅ Üres projekt: a Térkép a nulláról is használható — 2026-07-19
> Bug: üres projekten (0 node) a `if (!g.N.length) return <placeholder>` korai visszatérés ELREJTETTE a vásznat + a chat-dockot → a Térképről el sem lehetett kezdeni a munkát. (Egybevág a map-only audit „node-genesis / kezdés a Térképről" pontjával.)
- [x] ✅ **Fix** — a korai visszatérés **eltávolítva**; a teljes vászon + a 🤖 chat-dock + a radiális gyors-hozzáadás mostantól **üres projekten is renderel**. Üres állapotban egy **kis, nem-blokkoló üdvözlő kártya** (`.rmap-empty-hint`, a stage első gyermeke, `(!g.N.length)?…:null`) vezet: `onMouseDown` stopPropagation csak a kártyán (a vásznon máshol a dupla-katt továbbra is nyitja a radiálist), gyors-start gombok (szerkesztőnek): **✦ Első ötlet** (`ideaAtPos` a `stageVP`+`view` alapján a nézet közepére) · **📎 Adat feltöltése** (dock → Fájlok fül) · **💬 Asszisztens** (dock → Chat). A szöveg **read-only nézőnek** külön változat.
- Üres-biztonság kódból igazolva: `fitView` guardolt (5285), `graph()` eddig is lefutott üresen, nincs `g.N[0]`/osztás a render-úton. **Adversariális review: 0 megerősített** (3 nit elvetve: néző-szöveg [javítva], kártya-mögötti dupla-katt, dupla ötlet-insert — mind ártalmatlan). **NINCS migráció/edge.**

## ✅ Dock-chat fájl-feltöltés + csatolás (P0) — 2026-07-19
> Előzmény: a Map-dock „🤖 Asszisztens" chat vs. az Idea-fül `ChatPanel` parity-audit (→ `map-only-audit` artifact, `dock-chat` kategória).
> Design: interaktív mockup 3 verzióval (`dock-upload-mockup`, favicon 📎) → V1 (inline, az Idea-chat mintája) jóváhagyva.
- [x] ✅ **P0 (V1)** — a Map-dock chatbe bekerül a **fájl-feltöltés + csatolás**, az Idea-chat mintáját újrahasználva:
  - **`dkUpload(fileList)`** (a `ChatPanel.chatUpload` ~975 hű portja): drag-drop → `research-data` storage + `research_files`
    (`uploads/`), Office-kinyerés (docx/xlsx/pptx/csv), `freePath` verziózás. A feltöltött fájl `setBump`-pal **Map file-node**
    is lesz (loader ~5053 → `t:file` node ~5186, `updated_at desc limit 16` → a friss feltöltés benne van), és **a következő
    dock-üzenet csatolmánya** lesz.
  - **Drag-drop dropzone** a dock fölött (`.rmap-dock-dz` overlay + `[dDrop]` reset-effect az elakadás ellen) + **📎 gomb**
    az input-sorban → a meglévő **`AttachModal`** (~381) picker (könyvtári forrás / publikáció / LaTeX / feltöltés), a dock
    **testvéreként** mountolva (nem vágja le az `overflow:hidden`).
  - **Csatolmány-chipek** (`.rmap-dock-atts`) az input fölött (× eltávolítás); `dkSend` az `attachments` payloadba köti
    (a `research-chat` ugyanúgy olvassa, mint az Idea-chatnél; üresen kihagyva → pre-migration-17-safe; csak normál gépelt
    turn viszi, boundFrame/override nem). A `PipelineCanvas` mount most `sources` + `fileOwnerId` propot is kap.
  - **Hook-biztos:** 3 új useState (`dAttach`/`dDrop`/`dPick`) + a reset-effect **a guardok előtt**.
  - **Adversariális review: 0 találat** (2 reviewer × Read+Bash, hooks/upload-parity/materializáció mind tiszta). **NINCS migráció/edge.**
- [x] ✅ **P1 (fül-váltás)** — a dock fejlécében **💬 Chat / 🗂 Fájlok** fül (`dkTab` state a guardok előtt); a Fájlok fülön a
  meglévő **`SessionFileBrowser`** (704) nyílik a dock-törzsben (a chat-törzs `React.Fragment`-be csomagolva, `(dkTab!=='files')?…:filesDiv`).
  Fa + típus-érzékeny **előnézet** (md renderelve, CSV-tábla, kép, PDF signed-URL, kód) + saját feltöltés/letöltés/átnevezés/törlés/**csatolás**.
  `version=bump` → a P0-feltöltés (`setBump`) után a lista frissül; `onAttach`→`dAttach` (+toast) → a fából választott fájl a chat csatolmánya;
  `onAddIdea` szándékosan kihagyva (a FileIntake/selection-popup gracefully rejtve). CSS: `.rmap-dock-files` + `.filebrowser` felülírás
  (`flex:1; width:auto !important` — legyőzi a `256px/flex:none` bázist + az inline width-et), az `nd().fbx` fa+viewer flex-oszlop kitölt.
  A böngésző a dock **⤢ teljes-magasságával** kinyújtható. **Adversariális review: 0 találat** (2 reviewer × Read+Bash, hooks/wrap/integráció tiszta). **NINCS migráció/edge.**
- [x] ✅ **P1+ (3 finomítás, review 0 találat)** — **(1) picker-feltöltés→node:** az `AttachModal` (381) új `onUploadFile` propot vesz; a dock a `dkUpload`-ot adja át → a picker „Feltöltés" ága is `research_files` sort (Map-node) hoz létre + csatol (az Idea-chat változatlan, nem ad `onUploadFile`-t). **(2) transzkript-előzmény + streaming:** a dock megnyitáskor egyszer hidratálja a `dMsgs`-t a „Canvas asszisztens" szál `research_messages`-éből (funkcionális `setDMsgs cur.length<=1?…:cur` → nem ír felül in-session beszélgetést; a `[BECSATOLT KÁRTYA …]` prefix lecsupaszítva; `dcRef` cache → nincs dupla chat); a `dkSend` `stream:true`-ra váltott (reader-pump → `dStream` élő buborék + villogó `.rmap-dock-cursor`, a `dScroll` effekt `dStream`-re is görget; a fájl-blokkok a végén `CORE.saveFile`→node). **(3) ✨enhance:** `dkEnhance` (research-ai `action:'enhance'`) + gomb az input-sorban (graceful). 2 új useState (`dEnhancing`/`dStream`) + a hidratáló effekt **a guardok előtt**. **NINCS migráció/edge.**
- [x] ✅ **P2a — dock „💡 A beszélgetésből"** (review 0 találat): `dkSuggest` a dock gyors-parancs-sorába — az aktuális beszélgetés utolsó ~16 turnjéből (`dMsgs`, role ai/user + `text`) `research-ai action:'suggest'` → ötlet-jelöltek, `setBump`-pal **idea-node-ok** a térképen (a `dkCmd('ideas')` gap-mintáját követi, de beszélgetés-alapú). Üres beszélgetésnél előbb chatelésre kér; `dBusy`-guard + graceful edge-hiba. Plain függvény (nincs hook-hatás). **NINCS migráció/edge.**
- [ ] ⏳ **P2** — dock kijelölés→ötlet · böngésző-törlés/átnevezés is bumpolja a térképet · natív `window.PRFigureBoard`/… (ha az iframe kevés).

## ✅ macOS-Dock nagyítás — kártya-toolbar + Map-menüsor (egy közös réteg) — 2026-07-19
> 2 jóváhagyott mockup (`dock-toolbar-mockup` V1 kártya · `map-dock-mockup` középre-igazított menüsor), egyben implementálva.
- [x] ✅ **Közös motor** (`research.jsx`, modul-szint, `STAGE_ICONS` előtt): `dockMagnify(host,cx,spread,hotDist)` +
  `dockReset(host)` — kurzor-távolság → per-ikon skála **smoothstep** görbével (`t=t²(3−2t)`, `s=1+amp·t`,
  `amp=DOCK_REDUCE?0.28:0.95`), a `.rmap-dbtn` gombokat imperatíven skálázza (`transform`+`--s`+`zIndex`), a legközelebbi
  (< hotDist) kap `.rmap-dhot`-ot → megjelenik a neve. A lebegő címke **ellen-skálázott** (`scale(1/--s)`) → éles szöveg.
  Reduced-motion: amplitúdó 0,95→0,28. **React nem ad `style` propot a gomboknak** → az imperatív mutáció megmarad
  re-renderen át, a `mouseLeave→dockReset` törli (a következő `mouseMove` amúgy is újraszámol).
- [x] ✅ **① Kártya-toolbar** (`.rmap-seltool`): 7 ikon (📌🙈⚡⊞🔗⤢⤓) `rmap-dbtn` + `.rmap-dlab` címke; a sáv dock-stílust
  kap (blur, r14); `onMouseMove/Leave` (spread 78, hot 26). `selToolStyle` doboz 200×33 → 264×42 (fölfelé nagyít).
- [x] ✅ **② Map-menüsor** (`.rmap-zoom`): bal-alsó lapos sáv → **vászon-alja-közép** (`left:50%; translateX(-50%); bottom:16`);
  IIFE 3 csoportba szedi (**nézet ⎪ szerkesztés ⎪ zoom**), `.rmap-dsep` elválasztó **csak nem-üres csoportok között**;
  minden eredeti onClick/title/badge változatlan; `h.apply` spread (nincs key-warning); spread 82, hot 30.
- [x] ✅ **Review-fix (minor, medium):** minden **dock-triggerelt popup** (👁 típus-szűrő, 🖼/🫥 visszahozó, 📋 kommentek,
  🎬 bemutatók) a bal-alsó sarokból **a dock fölé, középre** került (`left:50%; bottom:74; translateX(-50%)`) — a régi
  `left:14;bottom:96` sarok-horgony leszakadva hatott az elmozdított gomboktól. A perzisztens bal-alsó chrome
  (`.rmap-elegend` él-legenda, `.rmap-hint`) marad — nem dock-triggerelt, nem ütközik.
- [ ] ⚠️ **Ismert korlát (nit, low — NEM javítva, szándékosan):** teljes eszközkészlet + **nyitott** Asszisztens-dock esetén
  ~≤1100px-es vászonon a centrált sáv jobb széle a jobb-alsó `.rmap-dock` alá érhet (mindkettő z-index:12). A javasolt
  `dkOpen`-feltételes −199px eltolás a **gyakori** széles esetben látható „ugrást" okozna a centrált sávon → rosszabb, mint
  a ritka overlap. `wheel`-zoom végig elérhető. Ha valaha bántó lesz: mérésalapú (csak-ha-szűk-ÉS-dkOpen) eltolás.

## 🚧 Figure Board + Citation Optimizer → Literature-alfülek — 2026-07-19
> Feltárás: 2-ágú (IA/nav · embed-mechanizmus) + kód-megalapozás design-workflow → szintézis → interaktív mockup
> (`litsub-mockup`, favicon 🖼). **A kérés:** a két külön-oldalas eszköz a Literature alá, mint a Rések.
- [x] ✅ **P0 — al-fülek iframe-embeddel** — két új al-fül a Literature (`i===2`) után, a Rések mellé, MINDKÉT navban
  (nd stageNav + klasszikus Stepper), `hasLib`-gated (**🖼 Ábrák** / **🔗 Idézetek**). A render **same-origin iframe**
  (`embedFrame(page)` → `Page.html?project=..&embed=1`), a két standalone app `embed=1`-nél elrejti a saját chrome-ját.
  panelForTab + content-switch ág; nincs `EMBEDDABLE` (nincs Map-deep-link). A régi Library **Citáció-link törölve**, az
  **Ábra-tábla gomb** in-app `setTab`-re konvertálva (élő kinyerés-badge marad), ✨ háttér-kinyerés + ⬇ BibTeX marad.
  **Nincs migráció, nincs séma.** Adversariális review: 1 minor javítva — az embed-CSS a FigureBoard topbar CHROME-ját
  rejti csak (`.brand`/`← Research`/`#fb-dark`), a FUNKCIONÁLIS vezérlők (`#grpseg` nézet · `#toghide` rejtett · `#modeseg`
  Simple/Pro) elérhetők maradnak; a CitationOptimizer topbar-ja tisztán chrome → teljes rejtés OK.
- [ ] ⏳ **P1** — mindkét iframe mountolva marad (`display` váltás, nincs újratöltés tabváltáskor) · in-frame dark-toggle rejtve · a keret-magasság flex-oszloppal. **P2** — natív `window.PRFigureBoard`/`PRCitationOptimizer` (mint PRCanvas/PRNotes), csak ha az iframe kevés.

## 🚧 Generálás-hibák: chat→file csonkolás · ötlet/rés-routing · provenance-link · preview-zoom — 2026-07-20
> Élő projektből („Healthcare OOD only on MAP") jelentett 4 hiba. Vizsgálat live-DB olvasással megerősítve
> (`map-generation-investigation` workflow); két batchben építve + adversariális review mindkettőre.
- [x] ✅ **Batch A / #1 (blokkoló, data-integrity) — `extractFiles` fence-tudatos parser** — a régi non-greedy
  `/```file:…([\s\S]*?)```/` a body ELSŐ belső ``` kerítésénél csonkolt (minden kód-blokkot tartalmazó chat-írt fájl
  adatvesztett). Új: soronkénti parser, ```lang (címkés) → mélység++, csupasz ``` → mélység-- vagy fájl-zárás, a
  **csupasz belső** kerítést lookahead-párosítás oldja fel (`bareLater`); csonkolt válasznál EOF-ig ment (nincs veszteség).
  **Live-DB bizonyíték:** a valódi 18025-karakteres válaszon a régi regex 904 karaktert, az új parser **16492**-t hoz ki
  (18×). 7/7 unit-teszt zöld (címkés/csupasz/multi/csonka/none). Review 1 major (csupasz kerítés) → javítva.
- [x] ✅ **Batch A / #3 (major) — ötlet↔rés routing** — a `✦ Ötletek` chip eddig a `gap` generátort hívta. Most:
  `dkGenIdeas` közös motor → `research-ai action:'suggest'` (VALÓDI ötletek, projekt+kijelölt kártya/részlet grounddal);
  külön **🕳 Rések** chip → `action:'gap'`. **Szabad-szöveges ötlet-intent** (`/ötlet/i` + ige) a chatben szintén
  ötletet generál (nem csonka fájlt). Review 1 minor (`adj` horgony) → javítva; + felfedezett latens bug: a `\bötlet`
  ASCII-`\b` miatt SOHA nem illeszkedett (a szabad-szöveges ág halott volt) → `/ötlet/i`-re javítva, 9/9 routing-teszt zöld.
- [x] ✅ **Batch A / #4 (minor) — preview far-zoom** — a `.rmap-t-pv` kikerült a LOD-0 sapkából (`.rmap-t-l/-xl/-fig`
  marad), a fájl-preview minden zoom-szinten látszik („semmi ne tűnjön el").
- [x] ✅ **Batch B / #2 (major) — provenance-link** — `autopilot-core.js saveFile` most `.select('id').maybeSingle()`
  (a régi `sf.error`-callerek változatlanok); új `linkToSource(srcNode, ids)` a generált node(oka)t a forrás-kártya
  mellé pinneli (`research_map_layout`, +320px, i*96 lépcső) + `manual` provenance-élt húz (`research_map_edges`,
  edge_key `src|nid|manual`, kind `kap` — mint `createManualEdge`). Bekötve az ötlet-gen (idea `'i'+id`) és a chat
  fájl-mentés (`'w'/'f'+id`, a becsatolt `an` kártyához) útba. Review 0 confirmed. **Ismert korlát (elfogadott):**
  `graph()` az ötleteket `created_at ASC limit(24)` tölti → ≥24 ötletnél egy frissen generált ötlet node-ja (és így a
  pin/él) inert lehet; a 24-sapka feloldása külön, map-szintű döntés (nem ebben a batchben).
- [ ] ⏳ **Utókövetés** — a már csonkolt `otlet_1_ct_mri_fusion_refinement.md` (904 kar.) NEM gyógyul magától; a teljes
  16492 kar. a chat-üzenetben megvan → kérésre újra-kinyerhető (megosztott-DB írás, user-jóváhagyással).
- [x] ✅ **Backfill (2026-07-21):** a live projektben a `otlet_1_...md` (904→16492 kar. tartalom is helyreállítva) + a 6
  régi gap a forrás `szabo_lorant_healthcare_ood_extension.md` mellé helyezve + 7 `manual` provenance-él a forrásból.
- [x] ✅ **Ütközés-elkerülő placement (2026-07-21):** a `linkToSource` fix offszet helyett a **`freeSpotsNear`** segéddel
  keres szabad helyet a forrás mellett — minden meglévő kártya valós lábnyomát (g.N + nodeW/nodeH) kikerülve, ≤3-oszlopos
  sor-major rácsban (AABB-teszt, konzervatív 204×120 új-kártya becslés). Így az AUTOMATIKUS elrendezés sosem rak kártyát
  másikra (a `separateNodes` szándékosan békén hagyja a két-pinned átfedést). Review CLEAN + 4 unit-teszt zöld.
- [x] ✅ **Layout-robusztusság teljessé (2026-07-21, éjszakai):** (1) **🧹 „Rendezd el"** parancs a menüsorban
  (`tidyLayout` → `separateNodes(arr,{})` minden kártya mozdítható → csak az egymásra csúszottakat húzza szét, a többi
  marad; csak a ténylegesen elmozdult kártyákat írja vissza; render-időbeli PX/PY-nal azonos → stabil). (2)
  **`placeInFrame`** kiszámolja a keretben MÁR bent lévő (batch-en kívüli, center-inside) kártyák celláit és kihagyja
  őket (slot-léptetés, `guard<500` teli-keret fallback), a keret a ténylegesen használt utolsó sorig nő; üres occ esetén
  bájtazonos a régivel. Review CLEAN + unit-teszt zöld. (Marad: `ideaAtPos` radial-nudge — minor, a radial csak üres vászonra nyílik.)

## 🚧 Térkép-teljesség: node-genesis (a teljes folyamat a Térképről) — 2026-07-21 (éjszakai)
> Az audit ~55%-ot mért Térkép-only elérhetőségre; a hátsó harmad azért tört meg, mert 4 node-típus
> renderel/embed-el/generál/töröl, de a vászonról nem SZÜLETHET meg. 5-ügynökös design-workflow → egységes minta:
> create-row → `placeNode` (pin+optimista+select) → deklaratív radial-regiszter. Mind kliens-oldali, migráció/edge nélkül.
- [x] ✅ **Shared helpers + dataset/section/venue (2026-07-21, review CLEAN):** (0) **`placeNode(nid,wx,wy,applyOptimistic)`**
  — az `ideaAtPos` közös farka kiemelve (layout-pin + optimista append VAGY setBump + select); az `ideaAtPos` erre
  refaktorálva (bájt-azonos). (1) **`datasetAtPos`** → `research_datasets` insert (`source:'other'`/`status:'registered'`,
  a letöltő-worker tétlen) → `'d'+id`, optimista datasets-concat (a limit(16) reload-sapka miatt kötelező). (2)
  **`sectionAtPos`** → `CORE.saveFile('writing/uj-szekcio-<ts>.md')` (egyedi útvonal → az upsert nem ír felül) → `'w'+id`
  szekció-node. (3) **`venueAtPos`** → `research_journal_picks` candidate (journal_id null) → `'v'+id`. (0b) A radial-menü
  deklaratív regiszterré alakítva (`{key,label,col,icon,on,run}`, ikon `s.icon`-ból); 3 új szegmens (✍️ Szekció · 🗂️ Adat
  · 🎯 Folyóirat) a Keret/Ötlet/Komment mellé, a gyűrű sugara n>4-nél 118px. Insert-oszlopok + node-id prefixek +
  optimista-alakok mind ellenőrizve a graph() ellen.
- [x] ✅ **Submission node-típus (2026-07-21, review CLEAN correctness):** a beküldési dosszié első osztályú 📤 node.
  `RMAP_TYPE.submission` + `EMBEDDABLE.submission` + `DEL_BY_TYPE.submission='research_files'`; a graph() a `submission/%`
  fájlokat a wfiles-be húzza (mfiles-ből kizárva) → `t:'submission'`, ph 6, `CEN[6]`+`PHASE_HU[6]` új sáv; `panelForTab`
  statikus indító-panel (Submissions.html link); **`submissionAtPos`** IDEMPOTENS (fix `submission/dossier.md` út — ha már
  van, csak kijelöli, nem írja felül) + 📤 radial-szegmens (a gyűrű 7-nél R=134). **Átsorolási hatás (graceful, egyszeri):**
  autopilot-projekteknél a meglévő dossier 'f'+id fájl-node → 'w'+id submission-node lesz; a TARTALOM megmarad, nem tűnik el,
  de a régi node-hoz kötött Map-állapot (kézi pozíció/pin, REJTETT-flag, kézi élek, node-komment-badge) elárvul → a node
  frissen elhelyezve, ph-6 sávban jelenik meg (egy korábban elrejtett dossier újra láthatóvá válik). Nem blokkoló; opcionális
  reggeli migráció tehetné varratmentessé ('f'→'w' layout/komment átnevezés). **A Térkép-only folyamat mind a 4 hiányzó
  genesis-útja kész (dataset/section/venue/submission) — ~55%→~90%.**

## 🚧 „Generálj ebből ▸" — kártya-horgonyzott determinisztikus generálás — 2026-07-21
> User-kérés: a kártya oldalán (az él-portoknál) hover-ívben jelenjenek meg a belőle DETERMINISZTIKUSAN előállítható
> objektum-típusok, kattintásra generálva. 3-ügynökös design-workflow (mátrix + UX + szintézis) → interaktív mockup
> (`gen-arc-mockup`, favicon ✦, url ede66761); user-választás: **A geometria (félkör-ív), címke JOBBRA az ikontól, teljes hatókör**.
- [x] ✅ **Megépítve (2026-07-21, review: 5 megerősített hiba javítva):** **`producibleTypes(n)`** = a determinisztikus
  forward-generálási mátrix (a `genActions` kiterjesztése content-node-okra is): 📎fájl→💡/🕳, 💬chat→💡, 💡ötlet→✦/🔎/🧪,
  🕳rés→💡/🔎/🧪, 📄cikk→💡/🧪, 🔎study→📝/🧪/💡, 📝review→🧪/✍️/🎯, 🧪lépés→✍️, 🎯venue→✍️/💡/📤, ✍️szekció→✍️/💡/🎯, 🗂adat→🧪
  (`det:'1'` 1-katt · `det:'+'` PRUI.confirm-mal). Kapuk: fájl csak szöveges kiterjesztésnél kínál ötletet, venue csak
  valós journal_id-nál 📤-t. **`runArcGen`** 10 ág, mind DEPLOY-olt edge-re (`research-ai`/`study`/`protocol`/`writing`/
  `journals`) + node-id visszanyerés a placementhez (ötlet `d.ideas`→'i', review `file_path`→'w', protokoll id-diff a
  **protocol_id**-re szűrve, writing/submission saveFile-id→'w', venue pick-insert→'v'). Minden a végén `linkToSource` +
  pulzus + `setBump` (graceful, ha nincs id). **UI:** ✦ `.rmap-arcpip` a kártya E-oldalán (portoknál, +24px kijjebb,
  `pointer-events` a portokként kapuzva), kattintásra **screen-space** (zoom-invariáns, `cardScreenRect`) félkör-ív per-típus
  színnel, **címke jobbra az ikontól** (150px-nél ellipszis + full `title`), jobb-szélnél NYUGATRA fordul (210px küszöb),
  scrim + Esc zár, `genBusy` alatt tiltva. **A jobb-katt menüt + portokat + dupla-katt radiálist KIEGÉSZÍTI.** Review-javítások:
  (1major) protokoll id-diff a nemlétező `project_id` helyett `protocol_id`-re (a link eddig MINDIG elveszett); (2major)
  arc-overlay `nodeVisible`-guard (rejtett kártyán nem lebeg árva ív); (3minor) study nem mozgatja a `lit` aggregátumot
  (`finish([])`, az idea→lit élt a graph() rajzolja); (4minor) arcpip `pointer-events:none` rejtett állapotban; (5nit)
  west-flip küszöb + címke-ellipszis. Version `research.jsx?v=1786360000`. Migráció/edge NEM kell. **Elhalasztva:** step→append_steps.
- [x] ✅ **Grounding-hűség revízió (2026-07-21, 3-ügynökös kutatás + review 2 fix):** a `producibleTypes` mátrix kritikai
  átvizsgálása (25 élből ~8 „ebből a kártyából" ígért, de projekt-szintű generátort futtatott). **7 átkötés:** (1) `*→szekció`
  a projekt-szintű `outline` helyett a kártya-alapú `research-writing action:'section'`-re (per-fájl `writing/sections/…tex`,
  **`context.research`-be** a `lineageOf` — a review kritikus fogása: az edge CSAK a `context.research`-öt olvassa);
  lépés→szekció + venue→szekció törölve. (2) 📎fájl→🕳rés (hamis, projekt-szintű) kivéve; 🔎study→🕳 + 📝review→🕳 hozzáadva
  (a rés a szintézis-node-okhoz). (3) `lineageOf` gap-ág → 🕳rés→🧪 a résből ground-ol. (4) visszafelé 🎯→💡, ✍️→💡 törölve.
  (5) 📄cikk→🔎study hozzáadva + a topSrc-select **abstract**-tal bővítve (különben a cikk-grounding dead code). (6) review→🎯
  törölve (korai), szekció→🎯 marad `hint`-tel. (7) `lineageOf` cikk-ág abstract-tal. Version `?v=1786480000`. **B folyam:**
  a 3 hiányzó szakasz (🖼️ elemzés/ábra · ❓ SR-kérdés/hipotézis · 📤 beküldés→revízió) tervezés alatt — új edge-ek kellenek.
- [x] ✅ **B folyam — Stage 2 (❓ SR-kérdés) + Stage 3 (📤→🔁 revízió) (2026-07-21, review CLEAN+1 fix, PUSHED):** 4-ügynökös
  design → mindhárom szakasz KLIENS-oldali MVP (deployolt edge + graceful fallback, NULL migráció). **Stage 2:** 💡ötlet/🕳rés
  → PICO **review-kérdés** (`research-study sr_suggest` + re-query → `'q'+id` srq-node); srq → **irodalom-study a kérdésből**
  (a mindig elérhető út; a study-branch kiterjesztve srq-forrásra: idea_id=srq.idea_id). Review-fix: ha a `sr_suggest` (a
  legrégebbi ~12 ötletet batcheli) nem készít kandidátust a kattintott ötlethez → **info-toast, nincs hamis siker**. Elhalasztva:
  `srq→sreview` (Elicit, entitlement + válasz-alak élteszt). **Stage 3:** új **🔁 revision** node-típus (`submission/revision-<n>.md`
  fájl-alapú, graph() `submission/revision-*`→t:revision); 📤 → **bírálati válasz** (kliens-vázlat; AI pontról-pontra a
  `research-writing:'revision'` edge-gel HA deployolod — graceful), 🔁 → **javított szekció** a kártya-alapú section-edge-en.
  Version `?v=1786600000`. **OPCIONÁLIS user-deploy:** `research-study` sr_suggest idea_id-kiterjesztés (sebészi single-idea),
  `research-writing:'revision'` (AI bírálati válasz).
- [x] ✅ **B folyam — Stage 1 (🖼️ elemzés/ábra) (2026-07-21, review 2 fix, PUSHED):** a BECSÜLETES MVP — a valós adat→eredmény
  számítás az autopilot dolga a dedikált gépen, nem a kliensé. **`fig_from_step`** (analysis/eval/figure lépésekre): a lépés
  végrehajtott `result.figures[].img` VALÓS (autopilot-renderelt) ábráit feltölti a research-data bucketbe + szintetikus
  `research_figures` sorokat (source_id NULL) → `'g'+id` figure-node-ok. **dataset/lépés→results:** eredmény/elemzés
  szekció-VÁZLAT a kártya-alapú section-edge-en (őszintén „-vázlat"-nak jelölve). **ábra→szekció.** `uploadDataUrlToFigure`
  segéd (dataURL→Blob→bucket→figure-sor). Review-fixek: (1) a figure-fetch `ascending`→`descending` (különben egy frissen
  generált ábra ~16 ábra fölött nem jelenne meg — csendes hamis siker); (2) `fig_from_step` idempotens (előbb törli a lépés
  korábbi szintetikus ábráit — a NULL source_id kijátssza az `unique(source_id,ord)`-t → duplikáció). Version `?v=1786720000`.
  **A teljes kutatási ív mostantól a Térképről vezethető: ötlet→irodalom→rés→SR-kérdés→study→protokoll→adat→eredmény/ábra→
  szekció→folyóirat→beküldés→revízió.** (Sematikus ábra valós grafikonhoz: PAPERBANANA edge — opcionális.)

## 🚧 Undo / Redo — a Térkép biztonsági hálója — 2026-07-21
> User-kérés: „új kártya nem a megfelelő helyre kerül, könnyű elveszíteni a folyamatot mi történt". 4-ügynökös tervezés →
> per-session, DATA-alapú inverz-op verem egy `useRef`-ben (túléli a graph() re-rendert), a MEGLÉVŐ guarded író-utakon
> visszajátszva; csak a SAJÁT gesztusokat vonja vissza; megosztott-guard kihagyja, ha közben más módosított.
- [x] ✅ **Tier 1 (`0f3eeb0`, review 2 fix):** **CREATE** (genesis + generáló-ív) → a friss kártya + pin + provenance-él
  EGY visszavonás-egység (törölhető sorok törlődnek; FK-nehéz protokoll-lépés/lit csak elrendezés-szinten, tartalom marad —
  a toast is ezt mondja); create = csak-undo (AI-tartalmat újragenerálsz). **MOVE** (egyedi+csoport) → teljes undo+redo,
  `layoutRef`-alapú megosztott-guarddal. **Nyomkövető toast** minden létrehozásnál. ⌘Z/⌘⇧Z/⌘Y + ↶/↷ menüsor-gombok
  (mélység-számmal); serialize-lock; projekt-váltáskor verem-null.
- [x] ✅ **Tier 2 + előzmény-panel (`<tbd>`, review 1 fix):** kézi ÉL létrehozás (undo=removeEdges, redo=setEdges);
  KERET create/group/delete (reinsert explicit id-vel — a schema+RLS engedi); PIN/REJTÉS (nodeSetFlag, undo=előző flag;
  a fix: ha közben resetLayout törölte a pint, a live pozícióra esik vissza, nem 0,0-ra). **🕘 Előzmény-panel**: a menüsorból
  nyíló lebegő lista (utolsó 12 művelet, legfrissebb felül, a következő-visszavonandó kiemelve) + ↶/↷ fejléc + redo-számláló
  — „jól látszik mi történt". Primitívek: hSetEdges/hFramePatch/hDeleteFrame/hReinsertFrame/hSetFlag. Version `?v=1787020000`.
  **Elhalasztva (finomítás):** keret-mozgatás/átnevezés (a közös framePatch-út zajos), él-restyle, átméretezés,
  undo-to-index a panelben. Migráció/edge NEM kell.
- [x] ✅ **T3 — TÖRLÉS-visszaállítás (`<tbd>`, review 1 fix — 3 defect):** a törölt kártya visszahozható ⌘Z-vel az
  **eredeti id-vel** — `delOneNode` `select('*')` teljes-sor pillanatképet vesz (nem a hiányos `n.ref`-et), törli a sort+pint,
  de **megtartja a storage-blobot** a hű visszaállításhoz (a soha-vissza-nem-vont törlés blob-ja árválkodik — vállalt csere).
  `hReinsertRows` explicit-id `insert` + pin-upsert; redo = `deleteRows`+`deleteLayout`. **Review-javítások:** (1) **step
  hard-fail** — `research_protocol_steps`-nek nincs `project_id` oszlopa (protocol_id-vel kulcsolt) → a `project_id`
  ráerőltetése 42703-mal elhasalt, a törölt lépés **véglegesen elveszett** a „visszaállítható" ígéret ellenére; fix:
  `NO_PROJECT_TBL` → e táblákra nem nyúlunk project_id-hez (insert ÉS delete). (2) **chat üres visszaállítás** — a
  `research_messages`/`research_evidence` CASCADE volt → az undo üres beszélgetést hozott vissza; fix: `CASCADE_CHILDREN`
  a törlés ELŐTT pillanatképezi a gyerekeket, `hReinsertRows` **sorrendben** szúrja be (szülő→gyerek, FK-helyes).
  (3) **idea SR-jelöltek** — `research_sr_candidates` CASCADE → szintén deep-snapshot. **Vállalt caveat:** protokoll-jegyzetek
  (INSERT-RLS `author_id=auth.uid()` → más felhasználó jegyzete nem visszaállítható) és a SET NULL back-linkek. Version `?v=1787330000`.

## ✨ Okos elrendezés — tartalom-tudatos réteges layout — 2026-07-21
> User-kérés: „egy összetett kártya-elrendező, ami figyelembe veszi a kártyák kontextusát, eredményét, méretét, tartalmát,
> hogy hogyan és mekkora méretben érdemes preview-ban látni". 4-ügynökös kutatás (graph-algo + content-sizing + UX) →
> szintézis: from-scratch réteges (Sugiyama-lite) layout, ~250-350 sor tiszta JS, dagre/elk kizárva (no-build/CSP).
- [x] ✅ **Okos elrendezés (`<tbd>`, review: 1 LOW fix, 8 check CLEAN):** ÚJ `✨` menüsor-gomb a 🧹/⌗ mellett (a másik
  kettő MARAD — más szándék: tidy = finom igazítás, Fázisokba = merev sávok, Okos = teljes tartalom-tudatos újrarendezés).
  **5 menet tiszta JS** (`smartLayout`): (1) MÉRET — `idealSize(n)` olcsó metaadatból (típus + `fileKind` + tartalomhossz)
  a @container küszöb FÖLÉ kerekítve, hogy a preview/vezérlő tényleg látszódjon (step 212×122, paper 212×118, figure
  244×204, csv 324×214, image 264×224, pdf/video 304×234, md/szekció ≥284×172; kompakt típus → null = auto-magasság);
  (2) RANG — oszlop = fázis (megőrzi a bal→jobb idővonalat); (3) SORREND — barycenter keresztezés-minimalizálás (6 söprés);
  (4) KOORDINÁTA — diszjunkt x-sávok (colW ≥ legszélesebb kártya) + magasság-fogyasztó y-verem → **ütközésmentes
  konstrukció szerint**; (5) ŐR — `separateNodes` a kitűzött kártyákra (fix akadály). **A kitűzött kártyákat békén hagyja**
  (pozíció+méret), a kézzel méretezetteket repozicionálja de a méretüket tartja. **EGY batch-upsert + EGY undo-egység**
  (pozíció ÉS méret): kibővített `hRestoreLayout` föltételesen viszi a `card_w/card_h`-t (a régi move-undo érintetlen — a
  `'card_w' in r` false rájuk). `.rmap-anim` átmeneti CSS-osztály animálja a méret-átrendezést (nem globálisan — a
  width/height minden zoom-lépésnél rángana), reduced-motion-guarddal. **Review-fix (LOW):** a `pushHist` az async upsert
  UTÁN futott → gyors ⌘Z rossz opot vont vissza + persist-hibánál árva optimista állapot; javítva: undo-egység
  **szinkron** push (mint histPushMove) + `rollback()` hibánál (visszaállít + kipattintja a saját bejegyzést). Migráció/edge
  NEM kell (a card_w/card_h a migration-80 óta megvan). Version `?v=1787360000`. **Elhalasztva (v2):** valódi ábra-aspect
  (research_figures width/height a select-be), md-magasság a valós renderelt tartalomból, medián-igazítás az él-egyenesítéshez.

## 🕰 Idővonal-nézet — „mikor mi jött létre" — 2026-07-21
> User-kérés: „valamiféle timeline szerű elrendezés, hogy lehessen látni, mikor mi jött létre". 4-ügynökös tervezés →
> interaktív mockup (artifact 1024df28, 🕰) → user-jóváhagyás: ÉPÍTSD MEG, alap = Sűrített.
- [x] ✅ **Idővonal-nézet v1 (`<tbd>`, review: 1 LOW fix / 4 top-priority + seam-ek CLEAN):** ÚJ `🕰 Idővonal` menüsor-gomb →
  **EFEMER** nézet (mint a gLive/story — SOHA nem ír `research_map_layout`-ba; `Esc`/gomb visszaáll a kézi elrendezéshez).
  **Seam:** a `graph()`-ban a gLive blokk UTÁN, a maxY ELŐTT egy `if (tlOn)` override-ág (`timelineLayout(N,E)` → n.x/n.y),
  ez a VÉGSŐ pozíció-szó → maxY/by/manuál-él fold ingyen újraszámol; tlOn=false esetén a `graph()` bittre a régi (a review
  igazolta a 100%-os semlegességet). **Idő-forrás:** `n.ts` egyetlen post-passban `n.ref.created_at`-ból (chat=updated_at),
  a `created_at` bekerült a betöltő select-ekbe; aggregátum/dátlan node DAG-becslést kap (min(gyerek)-eps / max(szülő)+eps,
  fixpont), a becsültek szaggatott kerettel (`rmap-tl-est`). **X-leképezés (3):** Sűrített (nap-bucket, szélesség ∝ darabszám,
  fix rés — az üresjáratot összehúzza, a tömeges gen-t szétlegyezi; ALAP) · Lineáris (valós idő-arány) · Sorrend (egyenletes).
  **Y-sáv (2):** Fázis (ph 0-6) · Típus. **Chrome (world-space, együtt zoomol):** fázis-sávok + címkék + dátum-vonalzó +
  „Dátlan" oszlop + narancs **lejátszófej**. **Scrubber (screen-space):** ⏮ ▶/⏸ ⏭ + húzható csúszka + dátum/„N / összes"
  kijelző; **lejátszáskor** a jövőbeli (ts > kurzor) kártyák elhalványulnak (`rmap-tl-future`), rAF ~9s-es söprés. **Seam-ek:**
  timeline-ban a húzás tiltva (csak kijelöl), pan/zoom `tlPause()` (szünet, NEM kilépés), `Esc`→`tlExit`, projekt-váltáskor/
  unmountkor a rAF leáll + a mód resetel (LOW-fix). Migráció/edge NEM kell. Version `?v=1787420000`. **Elhalasztva (v2):**
  „Mentés Bemutatóként" (a story-rendszerbe), követő-kamera, él-flow marsoló animáció, Származás (DAG-mélység) nézet, LOD chip-tömörítés.
- [x] ✅ **Idővonal v2 (`b9fb66a`, 5-dimenziós review-workflow: 7 találat → 5 dedup, mind javítva + fix-verify pass tiszta; regression-safe + hook-order-safe):**
  **(1) Származás (DAG-mélység) x-tengely** — 4. leképezés: `x = generáció a gyökértől` (miből mi, az órától függetlenül);
  longest-path **iteratív relaxációval** (rendezés-független + ciklus-klippelt); a lejátszófej + idő-alapú reveal/flow ebben
  a módban KIKAPCSOL (a `tlCurT` null depth-ben). **(2) 📷 Követő-kamera** — lejátszáskor a nézet finoman a lejátszófejet
  követi (`tlFollowCam` a rAF-loopban, view.tx easing; depth-ben no-op); a scrubberben kapcsolható (`tlFollowRef`). **(3) Él-flow**
  — lejátszáskor az az él, aminek az *okozat*-kártyája áthaladt a lejátszófejen, borostyánsárgán marsol (`rmap-e-tlflow`,
  `|b.ts-kurzor| < 3%`, `b.ts>=a.ts`). **(4) 🎬 Mentés Bemutatóként** — a kronológiai bejárás `research_map_paths` Prezi-story-ba
  (ts-sorrend, `kind:node` beat-ek); a `resolveBeat` élőben újra-feloldja a kártya VALÓS pozícióját → elrendezés-független.
  **Review-fixek:** a manuális éleket a `graph()` most a ts-bélyegzés ELŐTT folytja E-be (a depth-topológia + ts-fill lássa
  a user-húzta linkeket); a zoom-sáv gombjai (Nézetbe/±/100%) `tlPause()`-olnak (a follow-cam ne írja felül a kézi fitet).
  **LOD chip-tömörítés: kihagyva** — a meglévő LOD amúgy is kompakttá teszi a kártyákat timeline-ban. Migráció NEM kell
  (a Mentés a migration-79 `research_map_paths`-t használja, graceful ha nincs). Version `?v=1787480000`.

## 🔗 Automatikus él-feliratok — a magyarázat beleépül az élbe — 2026-07-22
> User: „a rendszer automatikusan írjon az auto-élekre szöveget, hogy a két kártyának mi köze van egymáshoz". 2 design-mockup
> (artifact 218dfe35 tartalom+megjelenítés; artifact 91063485 él-integrált ANIMÁCIÓK). User-választás: **✨ LLM-only tartalom +
> „Vonal-rés (gap)" megjelenítés-animáció.** ⚠️ Session-limit miatt a review-workflow most nem futott — manuális ellenőrzés.
- [x] ✅ **1. fél — Vonal-rés MEGJELENÍTÉS (`25ac5fe`, kliens-only, CSS-only, manuális audit):** a `.rmap-elabel` él-címke-pill
  átalakítva „gap"-re: a `--surface-2` (vászon-szín) háttér **MASZKOLJA az él vonalát** → a reláció-szöveg a vonal RÉSÉBEN ül
  (integrálva, nem lebegő pill), az él színével; nincs pill-keret (hoverre/kijelölve halvány currentColor-keret). **Kinyíló
  animáció** (`rmap-elabel-in`: scaleX .35→1 + letter-spacing, .32s, reduced-motion-guard). A meglévő render (`edgeLabelEls`
  @ view.k≥0.45, `edgeStyle(e).label`, `research_map_edges.label`) VÁLTOZATLAN — csak a stílus. Bármely címkét (kézi/LLM) így renderel.
- [x] ✅ **2. fél — ✨ LLM-GENERÁLÁS KÓD KÉSZ (`ad5f42f`, review: „feature sound" 1 LOW + 1 cosmetic fix; ⚠️ DEPLOY PENDING):**
  új `research-ai` akció **`explain_edge`** (a kliens átadja mindkét kártya típus+cím+snippetjét + a reláció-kindet → az LLM
  egy tömör magyar „miért kapcsolódnak" kifejezést ír; **NINCS DB-írás**, a kliens perzisztálja) az allow-list ELŐTT, az
  entitlement-kapu (`research_chat_ideas`) mögött; `explainEdge()` helper (askClaudeCell-mintára). **Kliens:** `explainOneEdge`
  (context-építés `edgeCardSnippet`-ből + invoke + `persistEdge(e,{label})` — derived élen manual:false marad → nem duplikál),
  **✨ Magyarázd meg** gomb az él-inspektorban + **✨ Élek magyarázata** a Nézet-menüben (batch, cap 24, soros, abort-on-first-fail).
  Review-fix: `explainOneEdge` mindkét hibaalakot (`r.error` ÉS `r.data.error`) nézi (az unpinned supabase-js miatt) → a batch
  abort-ja megbízhatóan indul; deploy-hint a toastokban. **Graceful:** telepítetlen edge → 400 → toast, nincs kár. **⚠️ AKTIVÁLÁS:
  `supabase functions deploy research-ai` — EXPLICIT user-jóváhagyás kell** (a deploy bundle-eli a párhuzamos session `_shared/entitlement.ts`-ét, mint a korábbi gap-deployok). Version `?v=1787760000`.

## 🎛️ Alsó dokk decluttering — ~23 → ~6 vezérlő egy sorban — 2026-07-22
> User: „az alsó toolbar nagyon hosszú lett, már két sorban vannak a funkciók — tervezz újra, hogy igényes legyen és ne
> legyen feleslegesen sok ikon." Kutatás+design workflow (audit + canvas-toolbar minták + újratervezés) → mockup (artifact
> e0cdd725, 3 variáns) → user-választás: **V1 — Popover-menük.**
- [x] ✅ **V1 kompakt dokk (`3174ef0`, review részleges [session-limit: 2/4 dim + 3 fix], manuális audit a többire):** a ~23 gomb →
  **6 elsődleges egység egy sorban:** `👁 Nézet ▾ · [⤫Szabad·⌗Fázis·🕰Idő ▾] · [↶↷] 🕘 💬 · [− nn%▾ +]`. **3 popover-menü**
  (a meglévő panel-minta + dock-magnify újrahasznosításával): **Nézet ▾** (Típus-szűrő, Fájlok, Export · Frissítés, Lap-túra,
  Bemutatók · Összes komment, Rejtett ábrák/kártyák), **Elrendezés-akciók ▾** (a switch caretjén, csak Szabadban: Okos, Rendezd
  el, ⌗ Fázisokba (végleges)+confirm, Reset, Új keret), **Nagyítás ▾** (a zoom-widget %-án: Nézetbe + 50/100/150/200%). A gyakori
  akciók (undo/redo, előzmény, komment, ±zoom) egy-kattintás maradnak. A menük a trigger alá horgonyzva (`openDMenu` +
  `dmenuAnchor` getBoundingClientRect), egyszerre egy, canvas-katt/Esc/mód-váltáskor záródnak. **Latens bug javítva:** a keydown-
  effekt `[focus,tour]` deps-e elavult closure volt a mód/menü-flagekre → kibővítve. **Review-fixek:** (HIGH) az onDown-closeDMenus
  visszanyitotta a saját triggerére kattintó menüt → az onDown csak NEM-dokk kattintásnál zár (`!e.target.closest('.rmap-zoom')`);
  (LOW) „Rejtett kártyák" visszakapta a `mapFlags` kaput; (LOW) Frissítés/Okos visszakapta a busy-disable-t. Version `?v=1787700000`.

## 🕰 Idővonal V3 — szerves Canvas-integráció („A vászon MAGA az idővonal") — 2026-07-21
> User: „az idővonal olyan, mint egy középre dobott különálló widget — épüljön be SZERVESEN a teljes Canvas-ba, az opciók
> TOGGLE-ök legyenek, az egész vászonra hassanak." 3-szög design-workflow → interaktív mockup (artifact 17d71fb0, 🕰, 3 variáns)
> → user-választás: **V3 „Szabad|Fázis|Idő" fő-kapcsoló, aktivitás-hisztogrammal.**
- [x] ✅ **V3 canvas-integráció (`0fe40a6`, 4-dim review-workflow: 5 fix + fix-verify pass: +2 write-path):** a „középen widget" érzés a KÉT lebegő
  központi dobozból jött (felső picker + alsó scrubber). Feloldva a vászon peremein: **(1) Dokk-elrendezés-pill** — a `🕰 Idővonal`
  gomb helyén `Elrendezés: ⤫ Szabad · ⌗ Fázis · 🕰 Idő` (a többi vászon-vezérlő mellett). **(2) ÚJ efemer „Fázis" elrendezés**
  (`phaseArrangeLayout` — fázis-oszlopok, magasság-tudatos, NEM persistál, NEM a romboló ⌗ Fázisokba; a `phaseArr` state a `tlOn`
  párja, mindkettő a `graph()` override-ban). **(3) Teljes szélességű alsó SÍN** (csak Idő-ben): bal=Idő/Sáv toggle-ök ·
  közép=lejátszó+scrub+**aktivitás-hisztogram** (`tlHistoBars`) · jobb=dátum+🎬 Mentés+✕ Kilépés. **(4) Fix bal sáv-GUTTER**
  (`renderTlGutter`) — screen-space, a világ-sávokra vetítve (`view.ty + band.top·view.k`), a címkék mindig látszanak, típus/fázis-
  színnel (`TL_PHASE_COLORS`/`TL_TYPE_COLORS`). **(5) Teljes-magasságú borostyán lejátszófej** (`top:0`) + a sín felső éle =
  közös **idő-gerinc**; a dokkok megemelkednek a sín fölé (`.rmap-tl-active`). Minden meglévő logika (`tlX/tlLane/timelineLayout/
  renderTlChrome/tlStartPlay/tlFollow`) VÁLTOZATLANUL újrahasznosul; csak a két lebegő doboz cserélve + a címkék a fix gutterbe.
  **Review-fixek (5):** (HIGH) a `🧹/✨/⌗` elrendezők + a `↺` NEM futhatnak efemer módban (a `startNodeDrag` read-only szerződését
  tükrözve — különben a transzient koordinátákat perzisztálnák → a „Szabad" veszteséges lenne): early-return guard + a 4 gomb
  csak `!tlOn && !phaseArr`-ban renderel; (MED) a `.rmap-dock-fab` a sín mögé került → lift; (LOW) a pill szélesíti a dokkot →
  `flex-wrap:wrap`; (LOW) a keretek Fázis-módban is rejtve (`tlOn || phaseArr ? []`). Fázis-módban a húzás is tiltva.
  **Fix-verify pass +2 kihagyott write-path** (ugyanaz a defect-osztály): `startNodeResize` (a méret-mentés perzisztálta az
  efemer x/y-t) + `nodeSetFlag` (pin/rejt egy soha-nem-elhelyezett kártyánál az efemer koordot írta) → guard + gomb-gate;
  `groupIntoFrame`/`frameCreate` szintén guardolva. **A veszteségmentes „Szabad" szerződés MINDEN pozíció-író úton zárva**
  (a genesis `placeNode` az ÚJ node saját pozícióját írja = legit; `resetCardSize`/undo a MENTETT `cur.x`-et, nem az efemert).
  Kliens-oldali, NINCS migráció. Version `?v=1787620000`.

## 🚫 FEDÉS-TILALOM minden elrendezésben + Markdown-kártya tartalom-méretezés — 2026-07-21
> User-kérés: „Fontos, hogy a kártyák SOSE kerüljenek fedésbe egymással az elrendezések során. Pl. a Markdown-kártyákat
> méretezzük a tartalmuknak megfelelően, hogy jól olvashatóak legyenek." Review: a fedés-garancia PROVABLY tartja (verify pass).
- [x] ✅ **Fedés-tilalom (`373f721`, review: garancia PROVABLY tartja, 1 LOW residual zárva):** két elrendező FIX sormagasságot
  használt → magasabb (méretezett md/ábra) kártya átfedte az alatta lévőt. **Idővonal** — a fix 132px helyett MAGASSÁG-TUDATOS
  alsáv-pakolás: minden alsáv annyi magas, amilyen a legmagasabb kártyája (`rowH[placed]`), a sor-tetők kumulatívak
  (`rowTop += rowH + RGAP`), vízszintesen 18px hézag-ellenőrzés → se függőleges, se vízszintes átfedés (konstrukció szerint).
  **Fázisokba (`autoLayoutStages`)** — a fix 74px/300px helyett a sáv a LEGSZÉLESEBB kártyához méreteződik (`laneW=max(300,
  maxW+48)`, középre), a `y` a VALÓS `nodeH(n)`-nel lép → se sávon belüli, se sávok közti átfedés; a keret-magasság a stack-hez
  igazodik. **Okos elrendezés** — már magasság-tudatos (méretezett kártya fix magasságú = pontos); GAPY 26→30 (kompakt-drift
  ráhagyás). **A gyökér-residuum zárva:** a `graph()` magasság-BECSLÉS cap-je 4→7 sor (egy hosszú-című, még nem mért kompakt
  kártya nem alul-becsül → az első-frame elrendezés sem fed; a túl-becslés csak ártalmatlan térközt ad). **Markdown-méretezés:**
  az `idealSize` eddig a `n.ref.content`-re támaszkodott, ami NINCS betöltve → minden md a 172px alapot kapta; most a BETÖLTÖTT
  `n.ref.size` (bájt) a proxy → md/szöveg 320×[210..470], csv 344×[214..480] a fájlmérettel arányosan; áténi a @container
  reveal + a richTier fetch küszöböt (nincs üres doboz), a Markdown ténylegesen renderel, olvashatóan. Version `?v=1787540000`.

## Hátralévő (jövő) — Phase 6+
- [ ] 🔴 **Teljes karakter-szintű CRDT/Yjs** — egyidejű azonos-szekció gépelés valós idejű merge-dzsel.
  A jelenlegi soft-lock + LWW ennek a könnyűsúlyú, függőség-mentes alternatívája; a teljes CRDT nagy
  külső függőség (Yjs + sync-provider) egy build-lépés nélküli, vendorelt kódbázisban — külön dependency-döntés.

> ⚠️ **A `migration-70..74` alkalmazása manuális** — lásd `AUTONOMOUS_SESSION_MANUAL_STEPS.md`.
> A kliens minden funkciónál **kecsesen degradál**: a migráció előtt az adott UI egyszerűen nem jelenik meg.
