// Alle Baustoffe des Bauplans: deutscher Name, Grundfarbe, Muster der selbst gezeichneten Textur.
// Der Generator prüft gegen diese Liste, so fällt ein vertippter Block sofort auf.
// Die echten Minecraft-Texturen dürfen wir nicht ausliefern, darum sind die Muster nur Annäherungen.

const b = (name, farbe, muster = 'beton', extra = {}) => ({ name, farbe, muster, ...extra });
const licht = (name, farbe, muster = 'lampe', staerke = 1) => b(name, farbe, muster, { leuchtet: staerke });

const FARBEN = {
  white: ['Weiß', 0xcfd5d6, 0xe9ecec], orange: ['Orange', 0xe0610a, 0xf07613], magenta: ['Magenta', 0xa9309f, 0xbd44b3], light_blue: ['Hellblau', 0x2389c7, 0x3aafd9],
  yellow: ['Gelb', 0xf0af15, 0xf8c627], lime: ['Hellgrün', 0x5ea918, 0x70b919], pink: ['Rosa', 0xd5658f, 0xed8dac], gray: ['Grau', 0x373a3e, 0x3e4447],
  light_gray: ['Hellgrau', 0x7d7d73, 0x8e8e86], cyan: ['Türkis', 0x157788, 0x158991], purple: ['Violett', 0x64209c, 0x792aac], blue: ['Blau', 0x2d2f8f, 0x35399d],
  brown: ['Braun', 0x603c20, 0x724728], green: ['Grün', 0x495b24, 0x546d1b], red: ['Rot', 0x8e2121, 0xa02722], black: ['Schwarz', 0x080a0f, 0x141519],
};

const farbig = {};
for (const [k, [n, beton, wolle]] of Object.entries(FARBEN)) {
  farbig[`minecraft:${k}_concrete`] = b(`Beton ${n}`, beton, 'beton');
  farbig[`minecraft:${k}_wool`] = b(`Wolle ${n}`, wolle, 'wolle');
  farbig[`minecraft:${k}_carpet`] = b(`Teppich ${n}`, wolle, 'wolle');
  farbig[`minecraft:${k}_bed`] = b(`Bett ${n}`, wolle, 'wolle');
  farbig[`minecraft:${k}_shulker_box`] = b(`Shulker-Kiste ${n}`, wolle, 'kasten');
  farbig[`minecraft:${k}_stained_glass`] = b(`Glas ${n}`, wolle, 'glas');
}

export const BLOECKE = {
  ...farbig,
  // Stein und Gestein
  'minecraft:stone': b('Stein', 0x7e7e7e, 'stein'),
  'minecraft:smooth_stone': b('Glatter Stein', 0x9f9f9f, 'glatt'),
  'minecraft:smooth_stone_slab': b('Glatte Steinstufe', 0x9f9f9f, 'glatt'),
  'minecraft:cobblestone': b('Bruchstein', 0x7a7a7a, 'bruch'),
  'minecraft:mossy_cobblestone': b('Bemooster Bruchstein', 0x6b7a5f, 'bruch'),
  'minecraft:cobbled_deepslate': b('Tiefenschiefer-Bruchstein', 0x4d4d50, 'bruch'),
  'minecraft:stone_bricks': b('Steinziegel', 0x7a7a7a, 'ziegel'),
  'minecraft:stone_brick_wall': b('Steinziegelmauer', 0x7a7a7a, 'ziegel'),
  'minecraft:andesite': b('Andesit', 0x888889, 'stein'),
  'minecraft:andesite_wall': b('Andesitmauer', 0x888889, 'stein'),
  'minecraft:polished_andesite': b('Polierter Andesit', 0x848685, 'poliert'),
  'minecraft:polished_andesite_slab': b('Polierte Andesitstufe', 0x848685, 'poliert'),
  'minecraft:polished_diorite': b('Polierter Diorit', 0xc1c1c3, 'poliert'),
  'minecraft:tuff': b('Tuffstein', 0x6c6d66, 'stein'),
  'minecraft:tuff_bricks': b('Tuffsteinziegel', 0x6e6f68, 'ziegel'),
  'minecraft:deepslate': b('Tiefenschiefer', 0x505053, 'stein'),
  'minecraft:polished_deepslate': b('Polierter Tiefenschiefer', 0x48484b, 'poliert'),
  'minecraft:deepslate_tiles': b('Tiefenschieferfliesen', 0x363638, 'kacheln'),
  'minecraft:deepslate_bricks': b('Tiefenschieferziegel', 0x464648, 'ziegel'),
  'minecraft:blackstone': b('Schwarzstein', 0x2a262c, 'stein'),
  'minecraft:polished_blackstone': b('Polierter Schwarzstein', 0x35313a, 'poliert'),
  'minecraft:polished_blackstone_slab': b('Polierte Schwarzsteinstufe', 0x35313a, 'poliert'),
  'minecraft:polished_blackstone_wall': b('Polierte Schwarzsteinmauer', 0x35313a, 'poliert'),
  'minecraft:smooth_quartz': b('Glatter Quarz', 0xece6df, 'glatt'),
  'minecraft:obsidian': b('Obsidian', 0x100c1c, 'poliert'),
  'minecraft:cyan_terracotta': b('Türkise Keramik', 0x575b5b, 'beton'),
  'minecraft:light_blue_terracotta': b('Hellblaue Keramik', 0x716d8a, 'beton'),
  'minecraft:red_terracotta': b('Rote Keramik', 0x8f3d2f, 'beton'),
  'minecraft:yellow_terracotta': b('Gelbe Keramik', 0xba8523, 'beton'),

  // Boden und Pflanzen
  'minecraft:grass_block': b('Grasblock', 0x6a9a46, 'gras'),
  'minecraft:moss_block': b('Moosblock', 0x596d2d, 'gras'),
  'minecraft:podzol': b('Podsol', 0x5b3d1d, 'erde'),
  'minecraft:coarse_dirt': b('Grobe Erde', 0x77553a, 'erde'),
  'minecraft:dirt_path': b('Trampelpfad', 0x94793f, 'erde'),
  'minecraft:farmland': b('Ackerboden', 0x5a3a1f, 'erde'),
  'minecraft:gravel': b('Kies', 0x837f7e, 'kies'),
  'minecraft:sand': b('Sand', 0xdbcfa3, 'kies'),
  'minecraft:snow_block': b('Schneeblock', 0xf9fefe, 'glatt'),
  'minecraft:hay_block': b('Heuballen', 0xa68a0d, 'holz'),
  'minecraft:short_grass': b('Gras', 0x5e8f3a, 'pflanze'),
  'minecraft:fern': b('Farn', 0x4f7d33, 'pflanze'),
  'minecraft:poppy': b('Mohn', 0xbb2b24, 'pflanze'),
  'minecraft:oxeye_daisy': b('Margerite', 0xdcdfd6, 'pflanze'),
  'minecraft:dandelion': b('Löwenzahn', 0xe2c41e, 'pflanze'),
  'minecraft:cornflower': b('Kornblume', 0x4a68c9, 'pflanze'),
  'minecraft:allium': b('Sternlauch', 0xb065d1, 'pflanze'),
  'minecraft:sugar_cane': b('Zuckerrohr', 0x8fc35f, 'pflanze'),
  'minecraft:bamboo': b('Bambus', 0x5e8a1e, 'pflanze'),
  'minecraft:carrots': b('Karotten', 0x5f9e3a, 'pflanze'),
  'minecraft:lily_pad': b('Seerose', 0x2f7a24, 'glatt'),
  'minecraft:carved_pumpkin': b('Geschnitzter Kürbis', 0xc36f0e, 'holz'),

  // Holz und Blätter
  'minecraft:oak_log': b('Eichenstamm', 0x6d5433, 'stamm'),
  'minecraft:birch_log': b('Birkenstamm', 0xd6d2c4, 'stamm'),
  'minecraft:spruce_log': b('Fichtenstamm', 0x3d2a17, 'stamm'),
  'minecraft:spruce_wood': b('Fichtenholz', 0x3d2a17, 'stamm'),
  'minecraft:dark_oak_log': b('Schwarzeichenstamm', 0x38291a, 'stamm'),
  'minecraft:oak_leaves': b('Eichenlaub', 0x4f7c2c, 'blatt'),
  'minecraft:birch_leaves': b('Birkenlaub', 0x7ba152, 'blatt'),
  'minecraft:spruce_leaves': b('Fichtennadeln', 0x35552e, 'blatt'),
  'minecraft:dark_oak_leaves': b('Schwarzeichenlaub', 0x2d5a1e, 'blatt'),
  'minecraft:azalea_leaves': b('Azaleenlaub', 0x5e8a2a, 'blatt'),
  'minecraft:flowering_azalea_leaves': b('Blühendes Azaleenlaub', 0x8f6fa0, 'blatt'),
  'minecraft:spruce_planks': b('Fichtenbretter', 0x6e4f2d, 'holz'),
  'minecraft:dark_oak_planks': b('Schwarzeichenbretter', 0x45301a, 'holz'),
  'minecraft:dark_oak_slab': b('Schwarzeichenstufe', 0x45301a, 'holz'),
  'minecraft:oak_fence': b('Eichenzaun', 0xa2824f, 'holz'),
  'minecraft:spruce_fence': b('Fichtenzaun', 0x6e4f2d, 'holz'),
  'minecraft:dark_oak_fence': b('Schwarzeichenzaun', 0x45301a, 'holz'),
  'minecraft:oak_trapdoor': b('Eichenfalltür', 0x9c7c47, 'holz'),
  'minecraft:bamboo_block': b('Bambusblock', 0x8f9a33, 'stamm'),
  'minecraft:bookshelf': b('Bücherregal', 0x6c4a26, 'regal'),

  // Metall und Technik
  'minecraft:iron_block': b('Eisenblock', 0xc8c9ca, 'metall'),
  'minecraft:iron_bars': b('Eisengitter', 0x7f8486, 'metall'),
  'minecraft:iron_trapdoor': b('Eisenfalltür', 0xb5b6b6, 'metall'),
  'minecraft:iron_door': b('Eisentür', 0xb5b6b6, 'metall'),
  'minecraft:iron_chain': b('Eisenkette', 0x3a3d45, 'metall'),
  'minecraft:gold_block': b('Goldblock', 0xf5d33e, 'metall'),
  'minecraft:emerald_block': b('Smaragdblock', 0x37c46d, 'metall'),
  'minecraft:coal_block': b('Kohleblock', 0x131313, 'stein'),
  'minecraft:redstone_block': b('Redstone-Block', 0xa31a09, 'metall'),
  'minecraft:lightning_rod': b('Blitzableiter', 0xbd7b52, 'kupfer'),
  'minecraft:waxed_copper_block': b('Gewachster Kupferblock', 0xc26a4d, 'kupfer'),
  'minecraft:waxed_cut_copper': b('Gewachstes geschnittenes Kupfer', 0xbc6a4e, 'kacheln'),
  'minecraft:waxed_exposed_cut_copper': b('Gewachstes angelaufenes Kupfer', 0xa38064, 'kacheln'),
  'minecraft:waxed_oxidized_copper': b('Gewachstes oxidiertes Kupfer', 0x4f9b83, 'kupfer'),
  'minecraft:waxed_copper_grate': b('Gewachstes Kupfergitter', 0xb9694a, 'lochblech'),
  'minecraft:waxed_exposed_copper_grate': b('Gewachstes angelaufenes Kupfergitter', 0x9d7d63, 'lochblech'),
  'minecraft:waxed_copper_chest': b('Gewachste Kupfertruhe', 0xc26a4d, 'truhe'),

  // Behälter und Redstone
  'minecraft:chest': b('Truhe', 0x9b6e30, 'truhe'),
  'minecraft:barrel': b('Fass', 0x7d5a2e, 'holz'),
  'minecraft:hopper': b('Trichter', 0x4a4a4d, 'metall'),
  'minecraft:dropper': b('Werfer', 0x6f6f70, 'kasten'),
  'minecraft:dispenser': b('Spender', 0x6f6f70, 'kasten'),
  'minecraft:crafter': b('Crafter', 0x5a4e4a, 'kasten'),
  'minecraft:observer': b('Beobachter', 0x5c5c5c, 'kasten'),
  'minecraft:piston': b('Kolben', 0x8a7a5c, 'kasten'),
  'minecraft:sticky_piston': b('Klebriger Kolben', 0x7a8a5c, 'kasten'),
  'minecraft:slime_block': b('Schleimblock', 0x70bd5b, 'glatt'),
  'minecraft:tnt': b('TNT', 0xb43a24, 'kasten'),
  'minecraft:comparator': b('Komparator', 0xa79c94, 'glatt'),
  'minecraft:redstone_wire': b('Redstone', 0xb01b09, 'glatt'),
  'minecraft:rail': b('Schiene', 0x8b7f6b, 'metall'),
  'minecraft:lever': b('Hebel', 0x6b5a3b, 'metall'),
  'minecraft:stone_button': b('Steinknopf', 0x7e7e7e, 'glatt'),

  // Arbeitsblöcke
  'minecraft:lectern': b('Lesepult', 0x9f7c46, 'holz'),
  'minecraft:loom': b('Webstuhl', 0xb08e62, 'holz'),
  'minecraft:fletching_table': b('Bognertisch', 0xb7a572, 'holz'),
  'minecraft:stonecutter': b('Steinsäge', 0x7a7a7a, 'kasten'),
  'minecraft:cartography_table': b('Kartentisch', 0x5b4733, 'holz'),
  'minecraft:blast_furnace': b('Schmelzofen', 0x4d4b4b, 'kasten'),
  'minecraft:smithing_table': b('Schmiedetisch', 0x37384a, 'kasten'),
  'minecraft:composter': b('Komposter', 0x7a5426, 'holz'),
  'minecraft:grindstone': b('Schleifstein', 0x8d8d8d, 'kasten'),
  'minecraft:smoker': b('Räucherofen', 0x5b4e3e, 'kasten'),
  'minecraft:cauldron': b('Kessel', 0x4a4a4d, 'metall'),
  'minecraft:brewing_stand': b('Braustand', 0x8a7a54, 'metall'),
  'minecraft:furnace': b('Ofen', 0x747474, 'kasten'),
  'minecraft:anvil': b('Amboss', 0x45484c, 'metall'),
  'minecraft:enchanting_table': b('Verzauberungstisch', 0x5b2a4a, 'kasten'),

  // Licht, Glas, Flüssiges, Besonderes
  'minecraft:sea_lantern': licht('Seelaterne', 0xc5ddd6),
  'minecraft:redstone_lamp': b('Redstone-Lampe', 0x5f3c22, 'kasten'),
  'minecraft:verdant_froglight': licht('Grünes Froschlicht', 0x8fe37a),
  'minecraft:lantern': licht('Laterne', 0xf2b95b, 'lampe', 1),
  'minecraft:end_rod': licht('Endstab', 0xf1e8d6, 'glatt', 1),
  'minecraft:beacon': licht('Leuchtfeuer', 0x8fe3e0, 'lampe', 1),
  'minecraft:campfire': licht('Lagerfeuer', 0xe39a33, 'lampe', 0.7),
  'minecraft:soul_campfire': licht('Seelenlagerfeuer', 0x4fd2d6, 'lampe', 0.7),
  'minecraft:magma_block': licht('Magmablock', 0x9e4a1c, 'stein', 0.35),
  'minecraft:lava': licht('Lava', 0xe87a1c, 'lampe', 1),
  'minecraft:nether_portal': licht('Netherportal', 0x6b1fc2, 'glatt', 0.8),
  'minecraft:water': b('Wasser', 0x2f6fc4, 'glatt'),
  'minecraft:glass': b('Glas', 0xc9e4ec, 'glas'),
  'minecraft:tinted_glass': b('Getöntes Glas', 0x2c2732, 'glas'),
  'minecraft:glass_pane': b('Glasscheibe', 0xc9e4ec, 'glas'),
};
