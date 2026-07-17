# Map / Canvas — Roadmap (Next Steps)

> A jelenlegi feladatok után ezek a **Next Step**-ek. Forrás: a LumaLabs Infinite Canvas Dashboard
> áttekintése + a saját javaslataink. Jelölés: ✅ kész · 🟡 részben · 🆕 új.
> Effort: 🟢 kicsi · 🟡 közepes · 🔴 nagy. Prio sorrend a végén.

## Kész (legutóbbi)
- [x] ✅ **Figure láthatóság-válogatás a térképen** (`#2`) — figure-node előnézeti kép + „🙈 Levétel a térképről" (`on_map`) + „Rejtett ábrák" restore panel. migration-69 alkalmazva. — *kész (c3f042a)*

## Külön nagy kezdeményezés
- [ ] 🆕🔴 **Kooperatív munka egy Research Projekten** (több user, Canvas + Workflow) — kutatás + fázisos terv + mockupok kész (Artifact: „Publify — Kooperatív Research Projekt"). Fázis 1 = `research_project_members` + a `research_can_write_project` write-gate átírása → minden `research_*` tábla egyszerre multi-writer; + komment/@mention + presence. Fázis 2 = élő kurzorok + hozzárendelés + sign-off. Fázis 3 = suggesting/CRDT a draft-editorra.

## Vászon-alapok
- [ ] 🆕🟢 **Zoom%-kijelző + „illeszd a nézetbe" gomb** a Map-en. *(Luma: „35%")*
- [ ] 🆕🟡 **Több „Page" projektenként** — pl. „teljes gráf" vs „kurált nézet" lapok. *(Luma: PAGE 1 ▾)*

## Csoportosítás / keretek
- [ ] 🆕🟡 **Fázis-lane-ek / nevesített keretek** — Ötlet → Irodalom → Protokoll → Írás → Beküldés sávok, vagy user-definiált keretek. *(Luma: „Batch 1/2/3" frames)*

## Kártya-szintű jelölők + akciók
- [ ] 🆕🟡 **Kártya-metaadat lebegő modalként a canvason** — a jelenlegi inspector (`rmap-insp`) az oldalsávban, a canvason KÍVÜL jelenik meg; helyette a kijelölt kártya MELLETT, a canvason lebegő popover/modalként jelenjen meg (a kártyához horgonyozva, pannal együtt mozog vagy a kártya mellé pozicionálva). *(Luma-szerű: a tartalom a vásznon marad)*
- [ ] 🆕🟡 **Per-node badge-ek**: pin/kedvenc + láthatóság (a Figure #2 általánosítása minden node-ra). *(Luma: piros pin + eye)*
- [ ] 🆕🟡 **Lebegő selection-toolbar** a kijelölt kártya fölött (megnyitás / generálás / rejtés / export). *(Luma: mini-toolbar a klaszter fölött)*

## Több-kijelölés + csoport-műveletek
- [ ] 🆕🔴 **Marquee / shift-klikk több-kijelölés** + csoport-műveletek (együtt mozgatás, „generálj mindegyikből", csoportos rejtés). *(Luma: bounding-box + handles)*

## Asszisztens-dock
- [x] ✅ **Becsatolt-elem chip** (kijelölt kártya → becsatolás) — *kész (fcd09fe)*
- [x] ✅ **Cselekvés a kártyából** (protokoll-lépés + utasítás → új lépés, megerősítéssel) — *kész (36bd464)*
- [ ] 🆕🟢 **Mód-választó** (Chat / Generálás / Akció) az input mellett. *(Luma: „✨ Create ▾")*
- [ ] 🆕🟢 **Hangbevitel (🎤)** a dockban. *(Luma: mic)*
- [ ] 🟡🟡 **Streamelt, strukturált kimenet** (a #2 akció-blokk folytatása + streaming). *(Luma: gazdag emoji-listák)*
- [ ] 🆕🟡 **Inline „generálj ide"** input egy kereten/sávon belül. *(Luma: „Type… 🎤" a klaszterben)*

## Alsó létrehozó-toolbar
- [ ] 🆕🟡 **Alsó insert-sáv** — ötlet / jegyzet / fájl / keret / komment hozzáadása közvetlenül a vászonra. *(Luma: kép/videó/audió/keret/rajz/szöveg/komment/felvétel)*

## Kollaboráció
- [ ] 🆕🟡 **Vászon-kommentek / annotációk** (node-hoz vagy pozícióhoz tűzve) — konzulensi visszajelzésre. *(Luma: komment-eszköz + panel)*
- [ ] 🆕🟡 **Térkép/csoport export** (PNG/SVG, vagy egy keret tartalma). *(Luma: per-csoport download ↓)*

## Fókusz / teljes képernyő
- [x] ✅ **Teljes-szélességű vászon + oldalsáv összecsukás** — *kész (afd5fce)*
- [x] ✅ **Animált adat-folyam élek** (forrás → cél) — *kész (afd5fce)*

---

## Javasolt sorrend (érték / erőfeszítés)
1. **Figure láthatóság-jelölő (#2)** — folyamatban; egyben Luma eye/pin minta.
2. **Mód-választó + hangbevitel a dockban** 🟢 — kicsi, nagy UX-ugrás.
3. **Fázis-lane-ek / nevesített keretek** 🟡 — olvashatóság.
4. **Lebegő selection-toolbar + több-kijelölés** 🟡/🔴 — Luma-szerű vezérlés.
5. **Vászon-kommentek + export** 🟡 — kollaboráció.
