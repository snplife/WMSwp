export const SCHERDEL_DOWNTIME_REASONS = [
  ["1", "Nastavenie stroja"],
  ["2", "Uvoľnenie výroby"],
  ["3", "Donastavenie"],
  ["4", "Výmena nástroja"],
  ["5", "Úprava nástroja / výmena dielu"],
  ["6", "Porucha elektroniky alebo CNC programu"],
  ["7", "Elektrická porucha stroja"],
  ["8", "Čakanie na elektrikára"],
  ["9", "Mechanická porucha stroja"],
  ["10", "Čakanie na údržbára"],
  ["11", "Porucha chladenia"],
  ["12", "Výpadok energie"],
  ["13", "Chýbajúci materiál alebo polotovar"],
  ["14", "Chýbajúci personál"],
  ["15", "Neexistujúca objednávka"],
  ["16", "Výmena materiálu"],
  ["17", "Chýbajúca viacobslužnosť"],
  ["18", "Zlá norma"],
  ["19", "Nenakomisionované polotovary"],
  ["20", "Porucha senzorov"],
  ["21", "Čakanie na zoraďovača"],
  ["98", "Zapracovanie (žiak)"],
  ["99", "Iné"]
].map(([code, name], index) => ({ code, name, sortOrder: index + 1 }));

export const SCHERDEL_DEFECT_REASONS = [
  ["A", "Chybne založený diel"], ["B", "Chýbajúci polotovar"],
  ["C", "Chybný alebo nedostatočný studený zvar"], ["D", "Chýbajúci zvar"],
  ["E", "Diel nie je v lôžku"], ["F", "Prepálený plech"],
  ["G", "Chybný polotovar"], ["H", "Nesúhlasí priemer drôtu"],
  ["CH", "Chýbajúce diely v balení"], ["I", "Nekvalitná povrchová úprava"],
  ["J", "Neprípustný grad alebo otrep"], ["K", "Chýbajúci ohyb"],
  ["L", "Laboratórna skúška"], ["M", "Chybne zmontovaný diel"],
  ["N", "Chybne zanitovaný diel"], ["O", "Chybná dĺžka dielu"],
  ["P", "Diel z nastavenia"], ["S", "Diel na skúšky"],
  ["T", "Otvorené očko"], ["U", "Diel bez očka"], ["V", "Krivý diel"],
  ["Z", "Zlomený alebo prasknutý diel"], ["X", "Nedolisovaný alebo nedostreknutý diel"],
  ["Y", "Prestrekutý diel"], ["Q", "Nečistota"],
  ["AA", "Farebnosť nezodpovedá vzorkovníku"], ["NA", "Navyše diely v balení"],
  ["PO", "Pomiešané diely v balení"], ["PD", "Prepálený drôt"],
  ["ND", "Neoznačený diel"], ["DS", "Diely zobraté na sorting"], ["W", "Iné"]
].map(([code, name]) => ({ code, name }));

export const SCHERDEL_MACHINE_ACTIVITIES = [
  ["BXXX", "Nastavenie stroja podľa ABK"],
  ["B906", "Donastavenie"],
  ["B907", "Výmena nástroja"],
  ["B908", "Oprava nástroja alebo stroja"],
  ["B909", "Výmena materiálu"]
].map(([code, name]) => ({ code, name }));

export const SCHERDEL_OVERHEAD_ACTIVITIES = [
  ["B902", "100 % kontrola z reklamácie"], ["B903", "100 % kontrola stála"],
  ["B904", "100 % kontrola po novom pracovníkovi"], ["B905", "100 % kontrola novej výroby"],
  ["B910", "Oprava dielov"], ["B911", "Počítanie dielov"], ["B912", "Čistenie dielov"],
  ["B920", "Zapracovanie (učiteľ)"], ["B921", "Školenie alebo porada"],
  ["B922", "Administratíva alebo zastupovanie majstra"], ["B923", "Upratovanie a čistenie pracoviska"],
  ["B924", "Medzioperačná kontrola"], ["B925", "Konečná kontrola"],
  ["B926", "Prebaľovanie dielov"], ["B927", "Vzorky"],
  ["B928", "Ručné obrusovanie zvarov"], ["B929", "Rozdelenie úloh alebo pracovných činností"],
  ["B930", "Nákup, príjem alebo výdaj dielov zo skladu ND"],
  ["B931", "Kontrola na ľu pri stroji"], ["B990", "Preprava dielov"], ["B999", "Iné"]
].map(([code, name]) => ({ code, name }));

export const SCHERDEL_ROLE_LABELS = {
  operator: "Operátor",
  setter: "Nastavovač",
  management: "Vedenie",
  maintenance: "Údržba",
  admin: "Administrátor",
  master: "Administrátor",
  user: "Operátor"
};
