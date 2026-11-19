import {
  AdRecord,
  extractAtOptionsMetadata,
  hasOwnInteractiveOrScriptElements,
  normalizeCreativeMarkup,
  validateSafeHttpUrl,
} from '../types/ads';

export type AdFrameRenderStatus =
  | 'loading'
  | 'script_loaded'
  | 'loaded'
  | 'no_inventory'
  | 'script_blocked'
  | 'error'
  | 'preview_unsupported'
  | 'popunder_ready';

export interface BuildSandboxedAdOptions {
  isHttps?: boolean;
}

function escapeHtmlAttr(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function upgradeProtocolForSandbox(url: string, isHttps: boolean): string {
  if (!url) return url;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) {
    return `${isHttps ? 'https:' : 'http:'}${trimmed}`;
  }
  if (
    isHttps &&
    /^http:\/\//i.test(trimmed) &&
    !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(trimmed)
  ) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  return trimmed;
}

/**
 * Normalizes Adsterra and third-party ad snippets so they execute properly inside an
 * isolated sandboxed iframe (`about:srcdoc`) without Mixed Content downgrades or
 * block-scoped `atOptions` shadowing.
 */
export function preprocessCreativeForSandbox(
  markup: string,
  options: BuildSandboxedAdOptions = {}
): string {
  const isHttps =
    typeof options.isHttps === 'boolean'
      ? options.isHttps
      : typeof window !== 'undefined' && window.location?.protocol
        ? window.location.protocol === 'https:'
        : true;

  let processed = markup || '';

  // Ensure `let atOptions` / `const atOptions` binds to `window.atOptions` for external invoke.js
  processed = processed.replace(/\b(?:const|let)\s+atOptions\b/g, 'var atOptions');

  // Upgrade protocol-relative URLs and insecure http:// URLs on script/iframe/img/source tags
  processed = processed.replace(
    /(<(?:script|iframe|img|source)\b[^>]*?\bsrc\s*=\s*)(["'])((?:https?:)?\/\/[^"']+)\2/gi,
    (_m, prefix: string, quote: string, url: string) =>
      `${prefix}${quote}${upgradeProtocolForSandbox(url, isHttps)}${quote}`
  );

  // Inside inline <script> blocks, fix `about:srcdoc` protocol checks (`location.protocol === 'https:'`)
  // which otherwise evaluate to `false` inside `about:srcdoc` and downgrade Adsterra URLs to `http://`.
  if (isHttps) {
    processed = processed.replace(
      /(<script\b(?![^>]*\bsrc\s*=)[^>]*>)([\s\S]*?)(<\/script>)/gi,
      (_m, openTag: string, body: string, closeTag: string) => {
        const fixedBody = body
          .replace(
            /\(\s*(?:window\.)?location\.protocol\s*===?\s*(['"])https:\1\s*\?\s*(['"])s\2\s*:\s*(['"])\3\s*\)/gi,
            "'s'"
          )
          .replace(
            /(?:window\.)?location\.protocol\s*===?\s*(['"])https:\1\s*\?\s*(['"])https:\2\s*:\s*(['"])http:\3/gi,
            "'https:'"
          )
          .replace(
            /(?:window\.)?location\.protocol\s*===?\s*(['"])https:\1/gi,
            'true'
          );
        return `${openTag}${fixedBody}${closeTag}`;
      }
    );
  }

  return processed;
}

export function buildSandboxedAdSrcDoc(
  ad: AdRecord,
  options: BuildSandboxedAdOptions = {}
): string {
  const isHttps =
    typeof options.isHttps === 'boolean'
      ? options.isHttps
      : typeof window !== 'undefined' && window.location?.protocol
        ? window.location.protocol === 'https:'
        : true;

  const normalizedCreative = normalizeCreativeMarkup(ad.scriptCode);
  const preprocessedCreative = preprocessCreativeForSandbox(normalizedCreative, { isHttps });
  const safeDest = validateSafeHttpUrl(ad.destinationUrl).sanitized;
  const hasOwnClickables = hasOwnInteractiveOrScriptElements(ad.scriptCode);
  const atMeta = extractAtOptionsMetadata(ad.scriptCode);

  // Only wrap with destinationUrl when the snippet has no existing interactive/script links.
  const wrappedCreative =
    safeDest && !hasOwnClickables
      ? `<a class="imagelab-ad-link" href="${escapeHtmlAttr(
          safeDest
        )}" target="_blank" rel="noopener noreferrer">${preprocessedCreative}</a>`
      : preprocessedCreative;

  const isPopunder = ad.adType === 'popunder';
  const normalizeCssDimension = (val?: string): string => {
    const trimmed = String(val || '').trim();
    if (!trimmed || trimmed === 'auto') return 'auto';
    return /^\d+$/.test(trimmed) ? `${trimmed}px` : trimmed;
  };
  const expectedMinWidth = normalizeCssDimension(
    ad.width && ad.width !== 'auto' ? ad.width : atMeta.width || 'auto'
  );
  const expectedMinHeight = normalizeCssDimension(
    ad.height && ad.height !== 'auto' ? ad.height : atMeta.height || 'auto'
  );

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
    min-width: ${expectedMinWidth !== 'auto' ? escapeHtmlAttr(expectedMinWidth) : '0'};
    min-height: ${expectedMinHeight !== 'auto' ? escapeHtmlAttr(expectedMinHeight) : '0'};
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
    var isHttpsParent = ${isHttps ? 'true' : 'false'};
    var providerName = ${JSON.stringify(ad.provider || 'Ad Network')};
    var atFormat = ${JSON.stringify(atMeta.format || '')};

    var externalScripts = [];
    var trackedElements = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nestedFrames = [];
    var blockedResources = [];
    var runtimeErrors = [];
    var imageErrors = [];
    var lastEmittedStatus = '';
    var hasSettledFinal = false;
    var crossOriginSettleTimer = null;

    function upgradeUrl(url) {
      if (typeof url !== 'string') return url;
      var trimmed = url.trim();
      if (!trimmed) return trimmed;
      if (trimmed.indexOf('//') === 0) {
        return (isHttpsParent ? 'https:' : 'http:') + trimmed;
      }
      if (
        isHttpsParent &&
        /^http:\\/\\//i.test(trimmed) &&
        !/^http:\\/\\/(localhost|127\\.0\\.0\\.1)(:|\\/|$)/i.test(trimmed)
      ) {
        return trimmed.replace(/^http:\\/\\//i, 'https://');
      }
      return trimmed;
    }

    function extractHost(url) {
      try {
        return new URL(upgradeUrl(url)).hostname || url;
      } catch (e) {
        return String(url || '').slice(0, 80);
      }
    }

    function postStatus(status, height, message, detail) {
      if (!window.parent) return;
      if (status === lastEmittedStatus && status !== 'loaded') return;
      lastEmittedStatus = status;
      try {
        window.parent.postMessage({
          type: 'imagelab-ad-status',
          id: adId,
          status: status,
          height: typeof height === 'number' ? height : 0,
          message: message || '',
          detail: detail || ''
        }, '*');
      } catch (e) {}
    }

    // 1. Ephemeral per-frame storage/cookie shims when opaque sandbox blocks native storage.
    // Isolated strictly in memory inside this sandboxed frame; parent tokens remain inaccessible.
    function createMemoryStorage() {
      var store = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, String(k)) ? store[String(k)] : null; },
        setItem: function (k, v) { store[String(k)] = String(v); },
        removeItem: function (k) { delete store[String(k)]; },
        clear: function () { store = {}; },
        key: function (i) { var keys = Object.keys(store); return keys[i] || null; },
        get length() { return Object.keys(store).length; }
      };
    }

    try {
      void window.localStorage;
    } catch (err) {
      try {
        Object.defineProperty(window, 'localStorage', { configurable: true, value: createMemoryStorage() });
      } catch (e) {}
    }
    try {
      void window.sessionStorage;
    } catch (err) {
      try {
        Object.defineProperty(window, 'sessionStorage', { configurable: true, value: createMemoryStorage() });
      } catch (e) {}
    }
    try {
      void document.cookie;
    } catch (err) {
      try {
        var memCookies = {};
        Object.defineProperty(document, 'cookie', {
          configurable: true,
          get: function () {
            return Object.keys(memCookies).map(function (k) { return k + '=' + memCookies[k]; }).join('; ');
          },
          set: function (val) {
            var part = String(val || '').split(';')[0];
            var eq = part.indexOf('=');
            if (eq > 0) {
              memCookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
            }
          }
        });
      } catch (e) {}
    }

    // 2. Error & CSP violation listeners
    window.addEventListener('error', function (ev) {
      if (ev && ev.target && ev.target !== window && ev.target.tagName) {
        var tag = String(ev.target.tagName || '').toLowerCase();
        var src = ev.target.getAttribute ? (ev.target.getAttribute('src') || '') : '';
        if (tag === 'script' || tag === 'iframe') {
          blockedResources.push({ tag: tag, url: src, reason: 'Failed network load or blocked by browser filter' });
        } else if (tag === 'img') {
          imageErrors.push(src || 'image resource');
        }
      } else if (ev && ev.message) {
        runtimeErrors.push(String(ev.message).slice(0, 200));
      }
      if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
    }, true);

    window.addEventListener('unhandledrejection', function (ev) {
      var msg = ev && ev.reason ? (ev.reason.message || String(ev.reason)) : 'Unhandled promise rejection';
      runtimeErrors.push(String(msg).slice(0, 200));
      if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
    });

    window.addEventListener('securitypolicyviolation', function (ev) {
      var blocked = ev && ev.blockedURI ? ev.blockedURI : 'external resource';
      blockedResources.push({
        tag: 'csp',
        url: blocked,
        reason: 'Blocked by Content Security Policy (' + (ev.violatedDirective || 'policy') + ')'
      });
      if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
    });

    function trackElement(el) {
      if (!el || !el.tagName) return;
      var tag = String(el.tagName).toLowerCase();
      if (tag === 'script') {
        var rawSrc = el.getAttribute ? (el.getAttribute('src') || '') : '';
        if (!rawSrc) return;
      }

      if (trackedElements) {
        if (trackedElements.has(el)) return;
        trackedElements.add(el);
      } else if (el.__imagelabTracked) {
        return;
      } else {
        el.__imagelabTracked = true;
      }

      if (tag === 'script') {
        var scriptSrc = el.getAttribute('src') || '';
        var upgraded = upgradeUrl(scriptSrc);
        if (upgraded !== scriptSrc) {
          try { el.setAttribute('src', upgraded); } catch (e) {}
        }
        var entry = { el: el, url: upgraded, status: 'pending' };
        externalScripts.push(entry);
        el.addEventListener('load', function () {
          entry.status = 'loaded';
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
        el.addEventListener('error', function () {
          entry.status = 'error';
          blockedResources.push({ tag: 'script', url: entry.url, reason: 'Script blocked or unreachable' });
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
      } else if (tag === 'iframe') {
        var fSrc = el.getAttribute('src') || '';
        var fUpgraded = upgradeUrl(fSrc);
        if (fUpgraded && fUpgraded !== fSrc) {
          try { el.setAttribute('src', fUpgraded); } catch (e) {}
        }
        var frameInfo = {
          el: el,
          src: fUpgraded,
          host: fUpgraded ? extractHost(fUpgraded) : 'inline frame',
          loadFired: false,
          errorFired: false
        };
        nestedFrames.push(frameInfo);
        el.addEventListener('load', function () {
          frameInfo.loadFired = true;
          var latestSrc = (el.getAttribute && el.getAttribute('src')) || frameInfo.src;
          if (latestSrc) {
            frameInfo.src = latestSrc;
            frameInfo.host = extractHost(latestSrc);
          }
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
        el.addEventListener('error', function () {
          frameInfo.errorFired = true;
          var latestSrc = (el.getAttribute && el.getAttribute('src')) || frameInfo.src;
          blockedResources.push({ tag: 'iframe', url: latestSrc || 'nested frame', reason: 'Nested ad frame failed or blocked' });
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
      } else if (tag === 'img') {
        var iSrc = el.getAttribute('src') || '';
        var iUpgraded = upgradeUrl(iSrc);
        if (iUpgraded && iUpgraded !== iSrc) {
          try { el.setAttribute('src', iUpgraded); } catch (e) {}
        }
        el.addEventListener('load', function () {
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
        el.addEventListener('error', function () {
          var latestImg = (el.getAttribute && el.getAttribute('src')) || iUpgraded || iSrc || 'image';
          imageErrors.push(latestImg);
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
      }
    }

    // Observe newly parsed or injected scripts, iframes, and images from the very start
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var i = 0; i < added.length; i++) {
            var node = added[i];
            if (node && node.nodeType === 1) {
              trackElement(node);
              if (node.querySelectorAll) {
                var sub = node.querySelectorAll('script[src], iframe, img');
                for (var j = 0; j < sub.length; j++) trackElement(sub[j]);
              }
            }
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }

    // 3. Safe createElement & document.write wrapper (upgrades Mixed Content URLs and avoids wiping document on late writes)
    var nativeCreateElement = document.createElement.bind(document);
    document.createElement = function (tagName, options) {
      var el = nativeCreateElement(tagName, options);
      var lower = String(tagName || '').toLowerCase();
      if (lower === 'script' || lower === 'iframe' || lower === 'img') {
        var proto = lower === 'script' ? HTMLScriptElement.prototype
          : lower === 'iframe' ? HTMLIFrameElement.prototype
          : HTMLImageElement.prototype;
        var srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
        if (srcDesc && srcDesc.set && srcDesc.get) {
          try {
            Object.defineProperty(el, 'src', {
              configurable: true,
              get: function () { return srcDesc.get.call(el); },
              set: function (v) {
                srcDesc.set.call(el, upgradeUrl(String(v || '')));
                trackElement(el);
              }
            });
          } catch (e) {}
        }
        if (el.setAttribute) {
          var origSetAttr = el.setAttribute.bind(el);
          el.setAttribute = function (name, val) {
            var nextVal = String(name || '').toLowerCase() === 'src' ? upgradeUrl(String(val || '')) : val;
            origSetAttr(name, nextVal);
            if (String(name || '').toLowerCase() === 'src') {
              trackElement(el);
            }
          };
        }
        trackElement(el);
      }
      return el;
    };

    var nativeWrite = document.write.bind(document);
    var nativeWriteln = document.writeln ? document.writeln.bind(document) : null;

    function rewriteHtmlUrls(html) {
      return String(html || '').replace(
        /(<(?:script|iframe|img)\\b[^>]*?\\bsrc\\s*=\\s*)(["'])((?:https?:)?\\/\\/[^"']+)\\2/gi,
        function (_m, p, q, u) { return p + q + upgradeUrl(u) + q; }
      );
    }

    function appendMarkupSafelyAfterLoad(html) {
      var root = document.getElementById('ad-root') || document.body;
      if (!root) return;
      var temp = nativeCreateElement('div');
      temp.innerHTML = rewriteHtmlUrls(html);
      var scripts = [];
      var children = Array.prototype.slice.call(temp.childNodes);
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        if (child.nodeType === 1 && child.tagName.toLowerCase() === 'script') {
          scripts.push(child);
        } else {
          if (child.nodeType === 1 && child.querySelectorAll) {
            var nestedScripts = child.querySelectorAll('script');
            for (var s = 0; s < nestedScripts.length; s++) {
              scripts.push(nestedScripts[s]);
            }
          }
          root.appendChild(child);
        }
      }
      for (var k = 0; k < scripts.length; k++) {
        var orig = scripts[k];
        var execScript = nativeCreateElement('script');
        for (var a = 0; a < orig.attributes.length; a++) {
          var attr = orig.attributes[a];
          execScript.setAttribute(attr.name, attr.name.toLowerCase() === 'src' ? upgradeUrl(attr.value) : attr.value);
        }
        execScript.async = false;
        if (!orig.getAttribute('src') && orig.textContent) {
          execScript.textContent = orig.textContent;
        }
        if (orig.parentNode && orig.parentNode !== temp) {
          orig.parentNode.replaceChild(execScript, orig);
        } else {
          root.appendChild(execScript);
        }
      }
    }

    document.write = function () {
      var joined = Array.prototype.join.call(arguments, '');
      if (document.readyState === 'loading') {
        nativeWrite(rewriteHtmlUrls(joined));
      } else {
        appendMarkupSafelyAfterLoad(joined);
      }
    };
    document.writeln = function () {
      var joined = Array.prototype.join.call(arguments, '') + '\\n';
      if (document.readyState === 'loading') {
        if (nativeWriteln) nativeWriteln(rewriteHtmlUrls(joined));
        else nativeWrite(rewriteHtmlUrls(joined));
      } else {
        appendMarkupSafelyAfterLoad(joined);
      }
    };

    // 4. Zero-False-Positive Visible Creative Inspection
    function isElementRenderedVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      try {
        var cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') <= 0.02) {
          return false;
        }
      } catch (e) {}
      var r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    }

    function getDirectVisibleTextLength(el) {
      var txt = '';
      for (var i = 0; i < el.childNodes.length; i++) {
        if (el.childNodes[i].nodeType === 3) {
          txt += el.childNodes[i].nodeValue || '';
        }
      }
      return txt.replace(/\\s+/g, '').length;
    }

    function inspectContainerDom(container, docRef) {
      if (!container) return { visible: false, kind: '', width: 0, height: 0, crossOriginFrames: [], sameOriginEmptyFrames: 0, brokenImages: [] };
      var crossOrigin = [];
      var emptySameOrigin = 0;
      var brokenImages = [];

      var all = container.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'meta' || tag === 'link') {
          continue;
        }
        if (tag === 'img' && el.complete && el.naturalWidth === 0) {
          brokenImages.push(el.getAttribute('src') || 'image resource');
          continue;
        }
        if (!isElementRenderedVisible(el)) continue;
        var rect = el.getBoundingClientRect();

        if (tag === 'img') {
          if (el.complete && el.naturalWidth > 1 && el.naturalHeight > 1 && rect.width >= 8 && rect.height >= 8) {
            return { visible: true, kind: 'image', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
          }
          continue;
        }

        if (tag === 'svg') {
          if (rect.width >= 16 && rect.height >= 16 && el.querySelector('path, rect, circle, ellipse, polygon, polyline, text, image')) {
            return { visible: true, kind: 'vector graphic', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
          }
          continue;
        }

        if (tag === 'canvas') {
          if (rect.width >= 16 && rect.height >= 16 && el.width >= 16 && el.height >= 16) {
            var hasPaintedPixels = false;
            try {
              var ctx = el.getContext('2d');
              if (ctx) {
                var data = ctx.getImageData(0, 0, Math.min(el.width, 32), Math.min(el.height, 32)).data;
                for (var p = 3; p < data.length; p += 4) {
                  if (data[p] > 0) { hasPaintedPixels = true; break; }
                }
              }
            } catch (secErr) {
              // Tainted canvas proves a cross-origin creative image was drawn onto it
              hasPaintedPixels = true;
            }
            if (hasPaintedPixels) {
              return { visible: true, kind: 'canvas creative', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
            }
          }
          continue;
        }

        if (tag === 'video') {
          if (rect.width >= 16 && rect.height >= 16 && el.readyState >= 2 && el.videoWidth > 0) {
            return { visible: true, kind: 'video', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
          }
          continue;
        }

        if (tag === 'iframe') {
          // NEVER treat an <iframe> tag by itself as rendered visible creative!
          var sameOriginDoc = null;
          var isCrossOriginFrame = false;
          try {
            sameOriginDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document) || null;
          } catch (frameErr) {
            isCrossOriginFrame = true;
          }
          if (sameOriginDoc && sameOriginDoc.body) {
            var nestedCheck = inspectContainerDom(sameOriginDoc.body, sameOriginDoc);
            if (nestedCheck.visible) {
              return nestedCheck;
            }
            emptySameOrigin += 1;
          } else {
            var fSrc = el.getAttribute('src') || '';
            if (isCrossOriginFrame || (fSrc && !/^about:/i.test(fSrc))) {
              crossOrigin.push({ host: extractHost(fSrc), src: fSrc, width: rect.width, height: rect.height });
            } else {
              emptySameOrigin += 1;
            }
          }
          continue;
        }

        if (rect.width >= 10 && rect.height >= 10) {
          var directTxtLen = getDirectVisibleTextLength(el);
          var bg = '';
          try { bg = (docRef.defaultView || window).getComputedStyle(el).backgroundImage || ''; } catch (e) {}
          var hasBgImg = Boolean(bg && bg !== 'none' && bg.indexOf('url(') !== -1);
          if (directTxtLen >= 2 || hasBgImg) {
            return {
              visible: true,
              kind: hasBgImg ? 'styled banner' : 'HTML creative',
              width: rect.width,
              height: rect.height,
              crossOriginFrames: crossOrigin,
              sameOriginEmptyFrames: emptySameOrigin,
              brokenImages: brokenImages
            };
          }
        }
      }

      if (getDirectVisibleTextLength(container) >= 2) {
        var rRoot = container.getBoundingClientRect();
        if (rRoot.width >= 10 && rRoot.height >= 10) {
          return { visible: true, kind: 'text creative', width: rRoot.width, height: rRoot.height, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
        }
      }

      return { visible: false, kind: '', width: 0, height: 0, crossOriginFrames: crossOrigin, sameOriginEmptyFrames: emptySameOrigin, brokenImages: brokenImages };
    }

    function countScriptStats() {
      var loaded = 0;
      var pending = 0;
      var failed = 0;
      for (var i = 0; i < externalScripts.length; i++) {
        if (externalScripts[i].status === 'loaded') loaded++;
        else if (externalScripts[i].status === 'error') failed++;
        else pending++;
      }
      return { total: externalScripts.length, loaded: loaded, pending: pending, failed: failed };
    }

    function hasLoadedCrossOriginFrame() {
      for (var i = 0; i < nestedFrames.length; i++) {
        var f = nestedFrames[i];
        if (f && f.loadFired && !f.errorFired) {
          var s = String(f.src || '');
          if (s && !/^about:/i.test(s)) return true;
        }
      }
      return false;
    }

    function clearCrossOriginTimer() {
      if (crossOriginSettleTimer) {
        clearTimeout(crossOriginSettleTimer);
        crossOriginSettleTimer = null;
      }
    }

    window.__imagelabAdProbe = {
      report: function (isFinal) {
        var root = document.getElementById('ad-root');
        var res = inspectContainerDom(root, document);
        var stats = countScriptStats();

        var docHeight = Math.max(
          root && root.getBoundingClientRect ? Math.ceil(root.getBoundingClientRect().height || 0) : 0,
          document.body ? Number(document.body.scrollHeight || 0) : 0,
          document.documentElement ? Number(document.documentElement.scrollHeight || 0) : 0
        );

        // 1. Confirmed visible creative always wins
        if (res.visible) {
          clearCrossOriginTimer();
          hasSettledFinal = true;
          postStatus(
            'loaded',
            docHeight,
            'Verified ' + res.kind + ' (' + Math.round(res.width) + '×' + Math.round(res.height) + 'px) rendered cleanly.'
          );
          return;
        }

        // 2. External script or nested frame was blocked / unreachable
        if (blockedResources.length > 0 && (stats.pending === 0 || isFinal)) {
          clearCrossOriginTimer();
          hasSettledFinal = true;
          var firstBlock = blockedResources[0];
          postStatus(
            'script_blocked',
            0,
            firstBlock.reason + (firstBlock.url ? ': ' + firstBlock.url.slice(0, 140) : '')
          );
          return;
        }

        // 3. JavaScript runtime exception or broken image asset
        var brokenImgUrl = imageErrors[0] || (res.brokenImages && res.brokenImages[0]) || '';
        if ((runtimeErrors.length > 0 || brokenImgUrl) && (stats.pending === 0 || isFinal)) {
          clearCrossOriginTimer();
          hasSettledFinal = true;
          var errMsg = runtimeErrors[0]
            ? 'Script runtime error: ' + runtimeErrors[0]
            : 'Creative image failed to load (' + String(brokenImgUrl).slice(0, 140) + ')';
          postStatus('error', 0, errMsg);
          return;
        }

        // 4. Intermediate progress signal: external scripts loaded, inspecting fill / nested frames
        if (!isFinal && !hasSettledFinal) {
          if (res.crossOriginFrames.length > 0 && stats.pending === 0 && hasLoadedCrossOriginFrame() && !crossOriginSettleTimer) {
            crossOriginSettleTimer = setTimeout(function () {
              crossOriginSettleTimer = null;
              if (window.__imagelabAdProbe) {
                window.__imagelabAdProbe.report(true);
              }
            }, 250);
          }

          if (stats.total > 0 && stats.loaded > 0 && stats.pending === 0) {
            postStatus(
              'script_loaded',
              0,
              'External ad script loaded (' + stats.loaded + '/' + stats.total + '); checking creative output...'
            );
          }
          return;
        }

        // 5. Final settle evaluation (never report 'loaded' when visually empty!)
        if (isFinal && !hasSettledFinal) {
          clearCrossOriginTimer();
          hasSettledFinal = true;
          if (isPopunder) {
            postStatus(
              'popunder_ready',
              0,
              'Popunder script loaded without errors (triggers on click/navigation rather than an inline banner).'
            );
            return;
          }

          if (res.crossOriginFrames.length > 0) {
            var frameHost = res.crossOriginFrames[0].host || providerName;
            postStatus(
              'preview_unsupported',
              docHeight,
              'External script loaded cleanly and mounted an isolated cross-origin frame (' +
                frameHost +
                '). Strict sandbox protection remains active; you can save and test this ad on the actual published website.'
            );
            return;
          }

          var noFillMsg = stats.loaded > 0
            ? providerName + ' script loaded (' + stats.loaded + ' script' + (stats.loaded > 1 ? 's' : '') + ') without errors, but returned no ad inventory or visible creative.'
            : (atFormat === 'iframe'
              ? providerName + ' snippet executed without errors, but no creative fill was returned.'
              : 'Advertisement snippet executed without errors, but produced no visible creative output.');
          postStatus('no_inventory', 0, noFillMsg);
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
      setTimeout(function () { run(false); }, 150);
      setTimeout(function () { run(false); }, 700);
      setTimeout(function () { run(false); }, 1600);
      setTimeout(function () { run(false); }, 2800);
      setTimeout(function () { run(true); }, 4200);
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
