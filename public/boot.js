/* Tema y modo sin color, antes del primer pintado.

   Esto vive en su propio archivo y no en un <script> inline porque la CSP del
   server es script-src 'self': un script inline lo bloquea el navegador, y el
   tema guardado se perdía en cada recarga. Va sin defer ni type=module a
   propósito: tiene que correr sincrónico, o verías un flash del tema
   equivocado en cada F5. */
(function () {
  var THEME = 'unrsschiquito.theme';
  var GRAY = 'unrsschiquito.gray';

  function stored(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;   // modo incógnito con storage bloqueado, por ejemplo
    }
  }

  var media = window.matchMedia('(prefers-color-scheme: dark)');
  var fromBrowser = function () { return media.matches ? 'dark' : 'light'; };

  var saved = stored(THEME);
  var d = document.documentElement.dataset;

  // Si nunca tocaste el botón, manda lo que dice el navegador.
  d.theme = saved === 'dark' || saved === 'light' ? saved : fromBrowser();
  d.gray = stored(GRAY) === 'on' ? 'on' : 'off';

  // Y si el sistema cambia solo (o le pusiste horario), lo seguimos, salvo que
  // hayas elegido a mano. El evento es para que la app repinte el ícono.
  media.addEventListener('change', function () {
    if (stored(THEME)) return;
    document.documentElement.dataset.theme = fromBrowser();
    window.dispatchEvent(new Event('themechange'));
  });
})();
