import { Boxes, ClipboardList, Clock3, Factory, FileText, MonitorSmartphone, ReceiptText, ShieldCheck } from "lucide-react";

export const LANDING_LEGAL_DOCUMENTS = {
  vop: {
    label: "VOP",
    title: "Všeobecné obchodné podmienky",
    intro: "Tieto podmienky upravujú základný rámec používania platformy Factory OS, onboardingu, dodávky modulov, hardware a súvisiacich implementačných služieb.",
    meta: ["B2B služba", "Platí pre onboarding a prevádzku platformy", "Individuálne nacenenie má prednosť pred orientačným cenníkom"],
    icon: FileText,
    sections: [
      {
        title: "1. Predmet služby",
        paragraphs: [
          "Factory OS poskytuje firmám webovú platformu a súvisiace digitálne nástroje pre sklad, výrobu, dochádzku, dokumenty, reporting a onboarding nových prevádzok.",
          "Rozsah aktivovaných modulov, hardware, konzultácií a onboarding služieb sa riadi podľa výberu zákazníka, potvrdeného setupu a následnej objednávky, checkoutu alebo individuálnej ponuky."
        ]
      },
      {
        title: "2. Objednávka a aktivácia",
        paragraphs: [
          "Zákazník si v onboarding flow alebo v nastaveniach firmy vyberá moduly, počty používateľov, hardware a prípadné požiadavky na pomoc s konfiguráciou systému.",
          "Platené služby a hardware sa aktivujú po potvrdení objednávky alebo po úspešnom checkout procese. Bezplatná vrstva sa môže aktivovať samostatne podľa aktuálneho cenníka.",
          "Ak onboarding obsahuje individuálne nacenené položky alebo implementačné práce, finálny rozsah a cena sa potvrdzujú samostatne pred ostrým spustením."
        ]
      },
      {
        title: "3. Fakturácia a platby",
        paragraphs: [
          "Predplatné, jednorazové setup poplatky a hardware sa účtujú podľa aktuálneho cenníka alebo individuálne dohodnutej ponuky.",
          "Ak zákazník uhradí predfaktúru, uhradená suma sa pri vystavení finálnej faktúry zohľadní a odpočíta od výslednej sumy na úhradu.",
          "V prípade pravidelného predplatného sa fakturačný interval, prípadné setup položky a termíny úhrad riadia potvrdeným billing modelom zákazníka."
        ]
      },
      {
        title: "4. Prevádzka, zmeny a zodpovednosť",
        paragraphs: [
          "Zákazník zodpovedá za správnosť údajov, ktoré do systému vkladá, a za správu interných prístupov svojich používateľov.",
          "Poskytovateľ zabezpečuje prevádzku platformy v primeranom rozsahu. Plánované rozšírenia, integrácie, migrácie dát a špecifické úpravy sa riešia samostatným dojednaním.",
          "Ak je súčasťou dodávky hardware alebo onsite implementácia, zákazník zabezpečí potrebnú súčinnosť, prístupy a technické podmienky pre nasadenie."
        ]
      },
      {
        title: "5. Ukončenie a podpora",
        paragraphs: [
          "Zákazník môže požiadať o ukončenie služby alebo zmenu rozsahu modulov podľa dohodnutého billing modelu a potvrdených obchodných podmienok.",
          "Podpora, onboarding asistencia a následné úpravy sa riešia cez dohodnutý komunikačný kanál medzi zákazníkom a poskytovateľom."
        ]
      }
    ]
  },
  gdpr: {
    label: "GDPR",
    title: "Ochrana osobných údajov",
    intro: "Factory OS spracúva osobné údaje len v rozsahu potrebnom na prevádzku služby, onboarding firmy, billing, podporu a správu používateľských prístupov.",
    meta: ["Minimálny rozsah údajov", "Prístup podľa rolí a firmy", "Prevádzkové logy pre audit a bezpečnosť"],
    icon: ShieldCheck,
    sections: [
      {
        title: "1. Aké údaje spracúvame",
        paragraphs: [
          "Môžu sa spracúvať identifikačné a kontaktné údaje firmy, administrátora a používateľov, najmä meno, email, telefón, pracovná pozícia a prístupové oprávnenia.",
          "Pri používaní dochádzky alebo prevádzkových modulov sa môžu ukladať aj prevádzkové eventy, terminálové záznamy, logy a auditné údaje.",
          "Pri obchodných moduloch sa môžu spracúvať aj údaje potrebné na cenové ponuky, objednávky, fakturáciu a komunikáciu so zákazníkom."
        ]
      },
      {
        title: "2. Účel spracúvania",
        paragraphs: [
          "Údaje sa používajú na registráciu účtu, vytvorenie firmy, onboarding, billing, správu pozvánok, nastavenie prístupov a bezpečnú prevádzku jednotlivých modulov systému.",
          "Prevádzkové logy a auditné záznamy slúžia aj na riešenie incidentov, obnovu histórie a ochranu pred duplicitnými alebo chybnými transakciami."
        ]
      },
      {
        title: "3. Právny základ a uchovávanie",
        paragraphs: [
          "Spracúvanie osobných údajov prebieha na základe plnenia zmluvného vzťahu, oprávneného záujmu na bezpečnej prevádzke systému alebo splnenia zákonných povinností.",
          "Údaje sa uchovávajú len počas obdobia potrebného na prevádzku služby, billing, audit, podporu a splnenie súvisiacich zákonných povinností."
        ]
      },
      {
        title: "4. Zdieľanie a ochrana",
        paragraphs: [
          "Údaje sa nezdieľajú s tretími stranami mimo nevyhnutných technologických, platobných a komunikačných partnerov potrebných na prevádzku služby.",
          "Prístup k údajom je obmedzený podľa rolí, firmy a oprávnení. Zákazník má mať vlastné interné pravidlá pre správu používateľov, zariadení a pracovných terminálov."
        ]
      },
      {
        title: "5. Práva dotknutých osôb",
        paragraphs: [
          "Používatelia a zákazníci môžu žiadať opravu nepresných údajov, obmedzenie spracúvania alebo výmaz údajov, pokiaľ to nie je v rozpore s účtovnými, zmluvnými alebo zákonnými povinnosťami.",
          "Konkrétne žiadosti o prístup k údajom alebo výmaz sa riešia cez kontaktný kanál poskytovateľa alebo cez zodpovedného firemného administrátora."
        ]
      }
    ]
  }
};

export const LANDING_FEATURES = [
  "Online skladový prehľad pre operatívu, vedúcich skladu aj manažment",
  "Fakturácia, cenové ponuky, objednávky a workflow v jednom firemnom systéme",
  "QR štítky, lokácie, pohyby materiálu a auditovateľná história skladových operácií",
  "Pripravenosť na e-shopy, order processing, mobilnú appku a viac firiem v jednom prostredí"
];
export const SITE_NAME = "Factory OS";
export const DEFAULT_SITE_URL = String(import.meta.env.VITE_SITE_URL || "")
  .trim()
  .replace(/\/+$/, "");
export const LANDING_TITLE = `${SITE_NAME} | Skladový monitoring a online prehľad zásob`;
export const LANDING_DESCRIPTION =
  "Skladový monitoring, online prehľad zásob a evidencia skladových pohybov v reálnom čase pre výrobu, logistiku a interné sklady.";
export const LANDING_USE_CASES = [
  "Sklady a logistické tímy, ktoré potrebujú mať zásoby, pohyby a lokácie pod kontrolou v reálnom čase.",
  "Výrobné firmy, ktoré chcú prepojiť sklad, objednávky, materiál a interné workflow do jedného systému.",
  "Majitelia a manažéri, ktorí chcú menej Excelu, menej chaosu a viac dát pre rozhodovanie."
];
export const LANDING_SERVICE_AREAS = [
  "Návrh a digitalizácia skladových procesov podľa konkrétnej prevádzky",
  "Nasadenie Factory OS, objednávok, fakturácie a firemných workflow modulov",
  "Prispôsobenie systému pre konkrétnu firmu, role, tlačové výstupy a dokumenty",
  "Príprava na e-shop integrácie, mobilný picking a order processing"
];
export const LANDING_OUTCOMES = [
  "Rýchlejší prehľad o stave skladu bez ručného dohľadávania",
  "Nižší počet chýb pri pohyboch, výdaji, fakturácii a objednávkach",
  "Jedno spoločné prostredie pre sklad, obchod aj backoffice",
  "Systém pripravený rásť spolu s firmou, nie len riešiť aktuálny problém"
];
export const LANDING_FAQ = [
  {
    question: "Čo dokáže Factory OS sledovať?",
    answer:
      "Aplikácia zobrazuje stav skladu, zásoby podľa lokácie, históriu pohybov, príjmy, výdaje, presuny, dokumenty aj firemné workflow v jednom rozhraní."
  },
  {
    question: "Je systém vhodný pre výrobu aj logistiku?",
    answer:
      "Áno. Systém je vhodný pre interné sklady, výrobu, logistiku aj obchodné tímy, ktoré potrebujú mať procesy v jednom firemnom nástroji."
  },
  {
    question: "Dá sa Factory OS napojiť na existujúce procesy?",
    answer:
      "Áno. Riešenie sa dá prispôsobiť konkrétnej firme, rolám, dokumentom, QR štítkom, lokátorom aj budúcim e-shop integráciám."
  }
];
export const LANDING_FLOW_SCENARIOS = [
  {
    key: "stock",
    icon: Boxes,
    eyebrow: "Sklad",
    title: "Príjem materiálu a lokácie",
    detail: "Materiál sa naskladní na pozície, systém drží množstvá, expirácie a dostupnosť pre picking aj výrobu.",
    metric: "128 ks dostupných",
    panelTitle: "Skladová vrstva",
    panelLabel: "Živý sample skladu",
    kpis: [
      { label: "Presnosť", value: "94.6%", note: "lokácie vs realita" },
      { label: "Pohyby", value: "142", note: "dnes spracovaných" },
      { label: "Rezervácie", value: "31", note: "čaká na picking" }
    ],
    bars: [
      { label: "Obsadenie regálov", value: "84%", width: "84%" },
      { label: "Príjmy materiálu", value: "57 ks", width: "62%" },
      { label: "Výdaj do výroby", value: "32 ks", width: "54%" }
    ],
    events: [
      { time: "08:12", text: "Príjem materiálu PLECH-02 na pozíciu A-01-04" },
      { time: "08:26", text: "Sklad rezervoval 32 ks pre výrobný príkaz VP-240322-01" },
      { time: "08:45", text: "Picker potvrdil výdaj vstupu na pracovisko Laser 2" }
    ]
  },
  {
    key: "production",
    icon: Factory,
    eyebrow: "Výroba",
    title: "Spotreba vstupov a výstupy",
    detail: "Výrobný terminál odpíše vstupy, zaeviduje výstup a vedúci vidí prestoje aj rozpracovanosť.",
    metric: "24 ks hotových",
    panelTitle: "Výrobná vrstva",
    panelLabel: "Živý sample výroby",
    kpis: [
      { label: "Linky", value: "3", note: "2 bežia, 1 prestavba" },
      { label: "Výstupy", value: "24 ks", note: "hotové dnes" },
      { label: "Prestoj", value: "18 min", note: "najväčší výpadok" }
    ],
    bars: [
      { label: "Plnenie plánu", value: "76%", width: "76%" },
      { label: "Spotreba vstupov", value: "32 ks", width: "58%" },
      { label: "Hotové výrobky", value: "24 ks", width: "61%" }
    ],
    events: [
      { time: "09:05", text: "Výroba odpísala 32 ks vstupu a naskladnila 24 ks hotového dielu" },
      { time: "09:18", text: "Majster označil prestavbu linky Lis 1 a systém prepočítal kapacitu" },
      { time: "09:44", text: "MES ukázal oneskorenie zákazky o 12 min oproti plánu" }
    ]
  },
  {
    key: "attendance",
    icon: Clock3,
    eyebrow: "Dochádzka",
    title: "Smeny, prítomnosť a kapacita tímu",
    detail: "Terminály a HR modul ukážu, kto je na zmene, koľko ľudí je na linke a kde hrozí výpadok kapacity.",
    metric: "92% obsadenie smeny",
    panelTitle: "Dochádzková vrstva",
    panelLabel: "Živý sample smeny",
    kpis: [
      { label: "Prítomní", value: "25", note: "z 27 plánovaných" },
      { label: "Absencie", value: "2", note: "1 PN, 1 dovolenka" },
      { label: "Kapacita", value: "92%", note: "obsadenie smeny" }
    ],
    bars: [
      { label: "Ranná zmena", value: "92%", width: "92%" },
      { label: "Výrobný tím", value: "88%", width: "88%" },
      { label: "Skladový tím", value: "96%", width: "96%" }
    ],
    events: [
      { time: "09:12", text: "Dochádzka potvrdila plný nábeh rannej smeny na 3 pracoviskách" },
      { time: "09:20", text: "Vedúci vidí absenciu operátora a presun na náhradné pracovisko" },
      { time: "09:33", text: "Kapacitný prehľad znížil výkon plánu na pracovisku Montáž 1" }
    ]
  },
  {
    key: "documents",
    icon: ClipboardList,
    eyebrow: "Dokumenty",
    title: "Objednávky, ponuky a faktúry",
    detail: "Z hotových alebo pripravených položiek vznikajú doklady bez prepisu dát medzi oddeleniami.",
    metric: "18 expedovaných objednávok",
    panelTitle: "Dokladová vrstva",
    panelLabel: "Živý sample obchodného toku",
    kpis: [
      { label: "Ponuky", value: "12", note: "otvorené dnes" },
      { label: "Objednávky", value: "18", note: "pripravené na expedíciu" },
      { label: "Faktúry", value: "6", note: "čaká na odoslanie" }
    ],
    bars: [
      { label: "Schválené ponuky", value: "67%", width: "67%" },
      { label: "Expedičná pripravenosť", value: "81%", width: "81%" },
      { label: "Rozfakturované zákazky", value: "72%", width: "72%" }
    ],
    events: [
      { time: "10:02", text: "Cenová ponuka CP-240322-04 sa preklopila na objednávku" },
      { time: "10:40", text: "Objednávka zákazníka sa uvoľnila do expedície podľa skladu" },
      { time: "11:40", text: "Objednávka sa preklopila do fakturácie a pribudla do obratu" }
    ]
  },
  {
    key: "kpi",
    icon: MonitorSmartphone,
    eyebrow: "KPI",
    title: "Výkon, OEE a manažérsky prehľad",
    detail: "Vedúci vidí priepustnosť toku, čakania, efektivitu zmien a čo priamo tlačí maržu alebo mešká.",
    metric: "OEE 78.4%",
    panelTitle: "KPI vrstva",
    panelLabel: "Živý sample výkonnosti",
    kpis: [
      { label: "OEE", value: "78.4%", note: "dnešný priemer" },
      { label: "Lead time", value: "2.8 h", note: "od príjmu po doklad" },
      { label: "Marža", value: "23.1%", note: "na dnešných zákazkách" }
    ],
    bars: [
      { label: "Výkon smeny", value: "78.4%", width: "78%" },
      { label: "Plnenie termínov", value: "86%", width: "86%" },
      { label: "Maržová disciplína", value: "73%", width: "73%" }
    ],
    events: [
      { time: "10:30", text: "Dashboard vyhodnotil pokles výkonu na jednej linke a dopad na maržu" },
      { time: "10:52", text: "KPI tabuľa upozornila na rast čakacej doby medzi skladom a montážou" },
      { time: "11:06", text: "Vedúci výroby porovnal aktuálny výkon smeny s plánom a minulým týždňom" }
    ]
  },
  {
    key: "revenue",
    icon: ReceiptText,
    eyebrow: "Obraty",
    title: "Denný prehľad obratu a marže",
    detail: "Majiteľ alebo obchod vidí obrat, rozfakturované zákazky a čo ešte čaká na billing.",
    metric: "14 820 € dnes",
    panelTitle: "Obratová vrstva",
    panelLabel: "Živý sample obratu",
    kpis: [
      { label: "Denný obrat", value: "14 820 €", note: "aktuálny súčet" },
      { label: "Marža", value: "3 424 €", note: "dnešný hrubý príspevok" },
      { label: "Billing čaká", value: "6", note: "dokladov bez odoslania" }
    ],
    bars: [
      { label: "Obrat dnes", value: "72%", width: "72%" },
      { label: "Inkaso vs plán", value: "64%", width: "64%" },
      { label: "Hrubá marža", value: "23.1%", width: "58%" }
    ],
    events: [
      { time: "11:40", text: "Faktúra FA-240322-06 pribudla do denného obratu" },
      { time: "12:05", text: "Majiteľ vidí rozpad obratu podľa zákazníkov a stredísk" },
      { time: "12:18", text: "Billing panel ukázal, ktoré zákazky ešte čakajú na uzavretie" }
    ]
  }
];

