import {
  AdRecord,
  hasOwnInteractiveOrScriptElements,
  normalizeCreativeMarkup,
  validateSafeHttpUrl,
} from '../types/ads';

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function buildSandboxedAdSrcDoc(ad: AdRecord): string {
  const normalizedCreative = normalizeCreativeMarkup(ad.scriptCode);
  const safeDest = validateSafeHttpUrl(ad.destinationUrl).sanitized;
  const hasOwnClickables = hasOwnInteractiveOrScriptElements(ad.scriptCode);

  // Only wrap with destinationUrl when the snippet has no existing interactive/script links.
  const wrappedCreative =
    safeDest && !hasOwnClickables
      ? `<a class="imagelab-ad-link" href="${escapeHtmlAttr(
          safeDest
        )}" target="_blank" rel="noopener noreferrer">${normalizedCreative}</a>`
      : normalizedCreative;

  const isPopunder = ad.adType === 'popunder';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<base target="_blank" rel="noopener noreferrer" />
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: #264653;
    font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
    overflow-x: hidden;
  }
  .ad-root {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .imagelab-ad-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    text-decoration: none;
    color: inherit;
    cursor: pointer;
  }
  img, iframe, ins, canvas, svg, video {
    max-width: 100%;
  }
</style>
<script>
  (function () {
    var adId = ${JSON.stringify(ad.id)};
    var isPopunder = ${isPopunder ? 'true' : 'false'};
    var capturedError = null;
    var settled = false;

    function postStatus(status, height, message) {
      if (!window.parent) return;
      try {
        window.parent.postMessage({
          type: 'imagelab-ad-status',
          id: adId,
          status: status,
          height: typeof height === 'number' ? height : 0,
          message: message || ''
        }, '*');
      } catch (e) {}
    }

    window.addEventListener('error', function (ev) {
      if (ev && ev.target && ev.target !== window && ev.target.tagName) {
        var tag = String(ev.target.tagName || '').toLowerCase();
        var src = ev.target.getAttribute ? (ev.target.getAttribute('src') || '') : '';
        capturedError = 'Failed to load ' + tag + (src ? ' (' + src.slice(0, 120) + ')' : '');
      } else if (ev && ev.message) {
        capturedError = String(ev.message).slice(0, 180);
      }
    }, true);

    function checkRenderedContent() {
      var root = document.getElementById('ad-root');
      if (!root) return { hasContent: false, height: 0 };

      var children = root.querySelectorAll('*');
      var visible = false;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'meta' || tag === 'link') {
          continue;
        }
        var rect = el.getBoundingClientRect();
        if (tag === 'img') {
          if (el.complete && el.naturalWidth > 0 && rect.width > 0 && rect.height > 0) {
            visible = true;
            break;
          }
          continue;
        }
        if (tag === 'iframe' || tag === 'canvas' || tag === 'svg' || tag === 'video') {
          if (rect.width >= 10 && rect.height >= 10) {
            visible = true;
            break;
          }
          continue;
        }
        if (rect.width >= 10 && rect.height >= 10) {
          var txt = (el.textContent || '').replace(/\\s+/g, '');
          var bg = '';
          try { bg = window.getComputedStyle(el).backgroundImage || ''; } catch (e) {}
          if (txt.length > 0 || (bg && bg !== 'none') || el.querySelector('img, iframe, canvas, svg, video')) {
            visible = true;
            break;
          }
        }
      }

      if (!visible) {
        var rootText = '';
        for (var n = 0; n < root.childNodes.length; n++) {
          if (root.childNodes[n].nodeType === 3) {
            rootText += root.childNodes[n].nodeValue || '';
          }
        }
        if (rootText.replace(/\\s+/g, '').length > 0) {
          visible = true;
        }
      }

      var h = Math.max(
        Math.ceil(root.getBoundingClientRect().height || 0),
        document.body ? document.body.scrollHeight : 0,
        document.documentElement ? document.documentElement.scrollHeight : 0
      );
      return { hasContent: visible && h >= 12, height: h };
    }

    window.__imagelabAdProbe = {
      report: function (isFinal) {
        var res = checkRenderedContent();
        if (res.hasContent) {
          settled = true;
          postStatus('loaded', res.height, '');
          return;
        }
        if (isFinal && !settled) {
          if (isPopunder && !capturedError) {
            settled = true;
            postStatus('popunder_ready', 0, '');
          } else if (capturedError) {
            settled = true;
            postStatus('error', 0, capturedError);
          } else {
            settled = true;
            postStatus('empty', 0, 'Advertisement script produced no visible ad output.');
          }
        }
      }
    };
  })();
</script>
</head>
<body>
  <div class="ad-root" id="ad-root">${wrappedCreative}</div>
  <script>
    (function () {
      var root = document.getElementById('ad-root');
      var run = function (isFinal) {
        if (window.__imagelabAdProbe) {
          window.__imagelabAdProbe.report(Boolean(isFinal));
        }
      };
      if (document.readyState === 'complete') {
        run(false);
      } else {
        window.addEventListener('load', function () { run(false); });
      }
      if (root) {
        var imgs = root.querySelectorAll('img');
        for (var j = 0; j < imgs.length; j++) {
          imgs[j].addEventListener('load', function () { run(false); });
        }
      }
      setTimeout(function () { run(false); }, 120);
      setTimeout(function () { run(false); }, 600);
      setTimeout(function () { run(false); }, 1500);
      setTimeout(function () { run(false); }, 3000);
      setTimeout(function () { run(true); }, 4500);
      if (typeof MutationObserver !== 'undefined' && root) {
        new MutationObserver(function () { run(false); }).observe(root, { childList: true, subtree: true, attributes: true });
      }
      if (typeof ResizeObserver !== 'undefined' && root) {
        new ResizeObserver(function () { run(false); }).observe(root);
      }
    })();
  </script>
</body>
</html>`;
}
