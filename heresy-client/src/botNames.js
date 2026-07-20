const BOT_NAMES = [
  // Loyalist Primarchs
  'Guilliman',
  'Dorn',
  'Vulkan',
  'Sanguinius',
  'Russ',
  'Khan',
  'Corax',
  'Ferrus Manus',
  // Traitor Primarchs
  'Lorgar',
  'Angron',
  'Mortarion',
  'Fulgrim',
  'Magnus',
  'Perturabo',
  'Alpharius',
  'Curze',
  'Horus',
  // Chaos Lords
  'Abaddon',
  'Kharn',
  'Typhus',
  'Ahriman',
  'Huron',
  'Lucius',
  'Fabius',
  'Haarken',
  'Erebus',
  'Kor Phaeron',
  // Imperial Heroes
  'Grimaldus',
  'Cid',
  'Calgar',
  'Dante',
  'Helbrecht',
  'Kyras',
  'Titus',
  'Leandros',
  'Tigurius',
  // Renowned Marines
  'Talos',
  'Xarl',
  'Sevatar',
  // Imperial Guard
  'Cain',
  'Gaunt',
  'Straken',
  // Inquisition
  'Eisenhorn',
  'Ravenor',
  'Coteaz',
  'Drago',
  'Kryptman',
  // Horus Heresy
  'Malcador',
  'Valdor',
  'Sejanus',
  'Erda',
  'Sindermann',
  'Keeler',
  'Loken',
  'Aximand',
  'Torgaddon',
  // Chapter Masters
  'Azrael',
  'Asmodai',
  'Belial',
  'Cypher',
  'Bjorn',
  'Grimnar',
  'Shrike',
  'Lemartes',
  'Mephiston',
  'Seth',
  'Lysander',
  // Traitor Champions
  'Skarbrand',
  'Nemeroth',
  'Honsou',
  'Tarvitz',
  'Moloc',
  'Typhon',
  'Dynat',
  // Custodes
  'Ra',
  // Mechanicus
  'Cawl',
  // Sororitas
  'Vahl',
  // Minotaurs
  'Asterion',
  // Foul Champions
  'Madox',
  // Others
  'Cadian',
  'Catachan',
  'Skitarius',
  'Magos',
  'Secutor',
];

function pickBotName() {
  return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
}

export { BOT_NAMES, pickBotName };