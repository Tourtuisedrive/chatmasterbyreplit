# Fiskegräns – Nedre Boksjön

Webbapp (PWA) som visar din position på en offline-karta och varnar med ljud
när du närmar dig gränsen för det vatten där du har fiskerätt – i första hand
statens vatten i Nedre Boksjön (65,58488° N, 16,06088° Ö).

> Appen är ett hjälpmedel. Det är fiskekortets villkor och Länsstyrelsens
> officiella karta som gäller. GPS i telefon har normalt 5–15 m felmarginal.

## Funktioner

- **Karta med din position** och GPS-noggrannhet (blå cirkel).
- **Färgad ram runt kartan**
  - 🟢 grön – innanför området
  - 🟠 orange (pulserar) – innanför men närmare gränsen än varningsavståndet
  - 🔴 röd – utanför området
  - ⚪ grå – ingen position eller ingen gräns inläst
- **Ljudlarm**, allt inställbart under ⚙️:
  - *Nära gränsen*: tydligt larm (ljud, volym, upprepning 3–20 s).
  - *Utanför*: diskret påminnelse (ljud, volym, upprepning 15 s–5 min).
  - *Tillbaka innanför*: kort kvitto när du kommer in igen.
  - Varningsavstånd 10–300 m, med valbar marginal för GPS-osäkerheten.
  - Ljuden skapas i appen, så inga ljudfiler behövs. På iOS 17+ hörs de även när
    ringknappen står på ljudlöst.
- **Offline**: appen sparas i telefonen, och kartbilder för området laddas ner
  med *⬇ Ladda ner kartan* (zoom 9–17, max 4000 bilder).
- **Fickläge 🌙**: svart skärm som håller skärmen vaken och blockerar
  oavsiktliga tryck. Ramen visar fortfarande zonen. Lås upp genom att hålla
  inne knappen i 2 s.
- **Gränsverktyg ✏️**: rita gränsen på kartan, lägg en punkt där du står
  (📍 Punkt här), importera GeoJSON/KML/GPX och exportera till GeoJSON.

## Lägga in fiskegränsen

Gränsen följer inte med ännu. Den måste tas från Länsstyrelsen Västerbottens
karta över statens vatten (fjällfiske) som hör till ditt fiskekort.

1. Öppna Länsstyrelsens karta för området på en dator eller i telefonen.
2. Gör något av följande:
   - **Rita** i appen: ✏️ → *Rita / redigera gräns* och tryck ut hörnpunkterna
     längs gränsen. Satellitbakgrunden (⚙️ → Kartbakgrund) gör det lättare att
     följa stränderna.
   - **Importera** en KML-, GeoJSON- eller GPX-fil, till exempel en gräns
     som ritats i Google My Maps eller ett GPX-spår från båten längs gränsen.
3. Exportera med *💾 Exportera som GeoJSON* och lägg filen som
   `data/boundary.geojson` i repot. Då blir den standardgräns för alla
   installationer.

Gränsen sparas i telefonen, så den finns kvar offline.

## Köra på iPhone

Platstjänster kräver https, så appen behöver ligga på en webbserver:

1. **GitHub Pages**: workflowen `.github/workflows/pages.yml` publicerar
   mappen `fiskegrans/`. Aktivera under *Settings → Pages → Source: GitHub
   Actions*. Pages på privata repon kräver ett betalt GitHub-konto, annars
   måste repot vara publikt.
2. Öppna adressen i **Safari** och tillåt platsåtkomst.
3. *Dela → Lägg till på hemskärmen* ger en egen ikon och helskärm.
4. Ladda ner kartan hemma på wifi (⚙️ → *Ladda ner kartan*).

Lokalt: `npm start` startar en server på http://localhost:8080.
Tester: `npm test`.

### Viktigt om iPhone och fickan

En webbapp på iPhone **slutar få GPS-positioner när skärmen låses**. Därför:

- Använd **fickläget 🌙**. Det håller skärmen tänd men svart, vilket drar lite
  batteri på OLED-skärmar.
- Om fickläget inte håller skärmen vaken (äldre iOS): ställ in
  *Inställningar → Skärm och ljusstyrka → Autolås → Aldrig* medan du fiskar.
- Ha gärna en powerbank med. GPS och tänd skärm drar ungefär 8–15 % per timme.

Sätter du på sidoknappen och låser telefonen pausas appen. När du låser upp
igen visas en påminnelse om det.

## Nästa steg: riktig app

För att larma även med låst skärm behövs en native-app:

- Paketera samma kod med **Capacitor**. Kartan, gränsverktyget och
  geometrin (`js/geo.js`) återanvänds rakt av.
- Lägg till ett plugin för bakgrundsposition, iOS-läget *Location updates*
  och behörigheten "Alltid".
- Spela larm via lokala notiser med ljud, eller via ljudsession i bakgrunden.
- Kräver Xcode (Mac eller molnbygge) och ett Apple-utvecklarkonto för att
  installera på telefonen.

## Struktur

```
index.html            Gränssnitt
styles.css            Stil, zonram, fickläge
js/app.js             Karta, GPS, larmlogik, inställningar, ritverktyg
js/geo.js             Innanför/utanför, avstånd till gräns, tiles, KML/GPX
js/alarm.js           Syntetiserade larmljud (Web Audio)
sw.js                 Service worker – offline för app och kartbilder
data/boundary.geojson Standardgräns (tom tills den läggs in)
vendor/leaflet/       Leaflet 1.9.4 (BSD-2)
test/geo.test.mjs     Enhetstester för geometrin
```

## Flytta till ett eget repo

Appen ligger i mappen `fiskegrans/` och kan brytas ut med sin historik:

```sh
git subtree split --prefix=fiskegrans -b fiskegrans-only
git push git@github.com:<användare>/fiskegrans.git fiskegrans-only:main
```

Flytta då `.github/workflows/pages.yml` och ändra `path: fiskegrans` till `path: .`.
