// Habitatkunnskap for rype og skogsfugl.
// Dette er generell, etablert viltfaglig kunnskap (fra bl.a. NINA, Norges
// Jeger- og Fiskerforbund og viltforvaltningen) ment som beslutningsstøtte —
// ikke en fasit. Lokale forhold, snøforhold og bestandssvingninger varierer
// mye fra år til år og område til område.

const HABITAT_DATA = {
  arter: [
    {
      id: "lirype",
      navn: "Lirype",
      ikon: "🐦",
      beskrivelse:
        "Holder til i bjørkebelte og vierkratt fra skoggrensa og opp mot snaufjellet, gjerne 400–900 moh avhengig av landsdel.",
      habitat: [
        "Vierkratt og dvergbjørk langs bekkedaler og myrkanter er kjerneleveområde.",
        "Liker mosaikk av kratt (skjul/mat) og mer åpne rabber (utkikk, spillplass, sandbad).",
        "Om høsten trekker de gjerne ned mot bjørkebeltet og bærlyng når snøen tar til i høyfjellet.",
        "Kokker (høner med kyllinger) holder seg ofte i fuktigere vierkratt/myrkanter med godt med insekter tidlig i sesongen.",
      ],
      terreng: [
        "Le-sider (i le for fremherskende vindretning) i dårlig vær.",
        "Sørvendte og østvendte skråninger tørker opp tidligere og har mer matplanter.",
        "Overganger mellom kratt og åpen mark er ofte mest produktive.",
        "Rabber og rygger nyttes til soling, sandbad og utkikk i fint vær.",
      ],
    },
    {
      id: "fjellrype",
      navn: "Fjellrype",
      ikon: "🏔️",
      beskrivelse:
        "Holder til høyere enn lirypa, i snaufjell med lav vegetasjon — typisk 600–1200+ moh.",
      habitat: [
        "Åpen, steinete/lynghei-preget fjellterreng med spredt dvergbjørk, vier og reinlav.",
        "Trekker til vindeksponerte rabber der snøen blåser bort, slik at mat er tilgjengelig vinterstid.",
        "Skyr tett kratt og skog — foretrekker mer åpent landskap enn lirype.",
      ],
      terreng: [
        "Rabber og vindutsatte rygger (lite snø, tilgang på lyng/frø).",
        "Steinete terreng med spredt vegetasjon gir god kamuflasje.",
        "I hardt vær søker de likevel ly i forsenkninger eller på leside.",
      ],
    },
    {
      id: "storfugl",
      navn: "Storfugl (skogsfugl)",
      ikon: "🦃",
      beskrivelse:
        "Knyttet til eldre, gjerne furudominert barskog, ofte med innslag av myr. Sky og arealkrevende art.",
      habitat: [
        "Eldre skog (gjerne 60+ år) med noe åpen bunnvegetasjon av bærlyng (blåbær/tyttebær) er viktig høst/vinterhabitat.",
        "Vinterstid lever storfugl i stor grad av furunåler — gammel, høyereliggende furuskog er derfor viktig.",
        "Spillplasser ligger ofte i eldre skog nær myr eller glenner, brukt år etter år (varsomhet rundt spilltid i april/mai er viktig, også utenom jaktsesong).",
        "Høner med kyllinger søker fuktigere skog/myrkanter med rikt insektliv de første ukene.",
      ],
      terreng: [
        "Skogkanter mot myr eller hogstflate — grensesoner er ofte gode søkeområder.",
        "Eldre skog med glissen tresetting og bærlyng i bunnen.",
        "Sør-/vestvendte skråninger med furu kan gi tidlig bærmodning om høsten.",
        "Rolige områder med lite ferdsel — storfugl er svært skytt for forstyrrelser.",
      ],
    },
    {
      id: "orrfugl",
      navn: "Orrfugl",
      ikon: "🦢",
      beskrivelse:
        "Foretrekker yngre, mer variert skog enn storfugl — gjerne skogkanter, myrer og hogstflater i gjenvekst.",
      habitat: [
        "Trives i mosaikk av ung/gammel skog, myr og lauvskog (bjørk, older) blandet med bar.",
        "Hogstflater i gjenvekst (10–30 år) med bærlyng og lauvoppslag er ofte gode.",
        "Spillplasser gjerne på myr eller åpne flater i skogen, tidlig vår.",
        "Om høsten beiter de gjerne på bjørkeknopper og bær i kantsoner.",
      ],
      terreng: [
        "Myrkanter og fuktige lauvskogsbelter.",
        "Overganger mellom ung skog/hogstflate og eldre skog.",
        "Åpne myrer omgitt av skog — gode spillplasser og beiteområder.",
      ],
    },
  ],

  sesong: [
    {
      periode: "Tidlig høst (august–september)",
      tips:
        "Kyllinger er fortsatt ikke fullvoksne — kull holder seg ofte samlet nær barmarksskrenter/vierkratt for rype og i fuktig skog/myrkant for skogsfugl. Morgentimer og sen ettermiddag er mest aktive.",
    },
    {
      periode: "Midt i sesongen (oktober)",
      tips:
        "Rype trekker gradvis nedover mot bjørkebeltet ettersom snøen tar til i høyfjellet. Skogsfugl beveger seg mer mot bærlyng-rike områder og etter hvert mot eldre furuskog når temperaturen synker.",
    },
    {
      periode: "Sein høst / vinter",
      tips:
        "Rype samles ofte i flokker (kobler) i le-terreng og vierkratt. Storfugl står tett opp til gammel furuskog med tilgang på nåler. Vindretning og le blir enda viktigere for hvor fuglen står i dårlig vær.",
    },
  ],

  dognrytme: [
    "Morgentimene rett etter soloppgang og de siste 1–2 timene før mørkt er ofte mest aktive beiteperioder.",
    "I varmt, klart vær midt på dagen trekker fugl gjerne til skygge/tettere vegetasjon og er mindre synlig/aktiv.",
    "I regn/vind søker fugl ly — let i le-terreng og tettere kratt/skog fremfor åpne rabber.",
  ],

  vaer: [
    "Sjekk vindretning før du planlegger gangrute — jaktvind (mothjelp med luktsans for hund) og fuglens forventede le-plassering henger sammen.",
    "Etter kraftig snøfall trekker rype gjerne til vindutsatte rabber der bakken blåser bar.",
    "I varmt, tørt vær tidlig i sesongen hold utkikk ved vann/myr hvor fugl søker fuktighet og insekter.",
  ],

  analysekart: [
    {
      navn: "Naturskog – sannsynlighet",
      kilde: "Miljødirektoratet og Landbruksdirektoratet",
      lansert: "Januar 2025",
      lenke: "https://www.miljodirektoratet.no/ansvarsomrader/overvaking-arealplanlegging/arealplanlegging/kart-over-naturskog/",
      forklaring:
        "Viser modellert sannsynlighet for naturskog — gammel, lite menneskepåvirket skog, inkludert felt etablert før 1940 og ikke flatehogd. Sterkere farge i kartlaget betyr høyere sannsynlighet. Naturskog er ofte det beste habitatet for storfugl og gir god dekning/ro for orrfugl.",
    },
    {
      navn: "Skogalder (SAT-SKOG)",
      kilde: "NIBIO",
      lenke: "https://www.nibio.no/tema/skog/kart-over-skogressurser/satskog/alder",
      forklaring:
        "Viser skogens aldersklasser (ungskog, eldre skog, gammel skog over ca. 80 år) basert på satellittdata. Gammel skog er spesielt viktig for storfugl, mens en mosaikk av ung/eldre skog er bra for orrfugl.",
    },
  ],
};
