import { RRWEB_CSS, RRWEB_JS } from './rrweb-bundle';

export function generateReplayViewerHtml(rrwebEvents: unknown[]): string {
  const eventsJson = JSON.stringify(rrwebEvents);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Replay Viewer</title>
  <style>${RRWEB_CSS}</style>
  <style>
    body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
    #player-container { width: 100vw; height: 100vh; }
    .replayer-wrapper { position: relative; }
    .replayer-wrapper > iframe { border: none; width: 1280px; height: 720px; }
  </style>
</head>
<body>
  <div id="player-container"></div>
  <script>${RRWEB_JS}</script>
  <script>
    (function() {
      var events = ${eventsJson};

      window.__replayReady = false;
      window.__replayError = null;
      window.__seekTo = function() { return Promise.resolve(); };

      if (!events || events.length === 0) {
        window.__replayReady = true;
        return;
      }

      try {
        var replayer = new rrweb.Replayer(events, {
          root: document.getElementById('player-container'),
          skipInactive: true,
          showWarning: false,
          liveMode: false,
          triggerFocus: false,
          mouseTail: false,
        });

        window.__seekTo = function(timeOffset) {
          return new Promise(function(resolve) {
            replayer.pause(timeOffset);
            requestAnimationFrame(function() {
              setTimeout(resolve, 500);
            });
          });
        };

        replayer.pause(0);
        window.__replayReady = true;
      } catch(e) {
        console.error('Failed to initialize replayer:', e);
        window.__replayError = e.message || String(e);
        window.__replayReady = true;
      }
    })();
  </script>
</body>
</html>`;
}
