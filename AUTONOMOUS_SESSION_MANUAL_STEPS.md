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

## Edge-function deploy-ok (explicit jóváhagyás + megnevezés kell)

_(A lista alább bővül.)_

## Egyéb (megosztott DB-írás, konfig)

_(A lista alább bővül.)_

---

## Elkészült funkciók (kliens kész, migráció-függő)

_(A lista alább bővül.)_
