// Hell oder Dunkel. Läuft ganz am Anfang der Seite, bevor etwas gezeichnet wird, sonst blitzt es hell auf.
// Ohne eigene Wahl gilt die Einstellung des Geräts.
(function () {
  var SCHLUESSEL = 'bruno-thema';
  var FARBE = { hell: '#1C1416', dunkel: '#0E0B0C' };
  var geraet = window.matchMedia('(prefers-color-scheme: dark)');

  function gespeichert() {
    try {
      var w = localStorage.getItem(SCHLUESSEL);
      return w === 'hell' || w === 'dunkel' ? w : 'system';
    } catch (e) {
      return 'system';
    }
  }

  function anwenden() {
    var wahl = gespeichert();
    var aktiv = wahl === 'system' ? (geraet.matches ? 'dunkel' : 'hell') : wahl;
    var html = document.documentElement;
    html.dataset.thema = wahl;
    html.dataset.themaAktiv = aktiv;
    html.style.colorScheme = aktiv === 'dunkel' ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', FARBE[aktiv]);
    document.dispatchEvent(new CustomEvent('thema', { detail: { wahl: wahl, aktiv: aktiv } }));
  }

  window.brunoThema = {
    wahl: gespeichert,
    aktiv: function () { return document.documentElement.dataset.themaAktiv; },
    setzen: function (w) {
      try {
        if (w === 'system') localStorage.removeItem(SCHLUESSEL);
        else localStorage.setItem(SCHLUESSEL, w);
      } catch (e) { /* Ohne Speicher gilt die Wahl nur bis zum Neuladen nicht: Gerät entscheidet. */ }
      anwenden();
    },
  };
  geraet.addEventListener('change', anwenden);
  anwenden();
})();
