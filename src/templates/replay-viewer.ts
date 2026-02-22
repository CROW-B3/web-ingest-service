export function generateReplayViewerHtml(rrwebEvents: unknown[]): string {
  const eventsJson = JSON.stringify(rrwebEvents);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Replay Viewer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/style.css">
  <style>
    body { margin: 0; padding: 0; background: #fff; }
    #player-container { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="player-container"></div>
  <script src="https://cdn.jsdelivr.net/npm/rrweb@latest/dist/rrweb.umd.cjs.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@latest/dist/index.js"></script>
  <script>
    (function() {
      var events = ${eventsJson};

      window.__replayReady = false;
      window.__seekTo = function() {};

      if (!events || events.length === 0) {
        window.__replayReady = true;
        return;
      }

      var player = new rrwebPlayer({
        target: document.getElementById('player-container'),
        props: {
          events: events,
          width: 1280,
          height: 720,
          autoPlay: false,
          showController: false,
          speed: 8,
        },
      });

      window.__seekTo = function(timeOffset) {
        return new Promise(function(resolve) {
          player.goto(timeOffset);
          setTimeout(resolve, 500);
        });
      };

      window.__replayReady = true;
    })();
  </script>
</body>
</html>`;
}
