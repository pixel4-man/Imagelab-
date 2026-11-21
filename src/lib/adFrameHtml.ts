import {
  AdRecord,
  extractAtOptionsMetadata,
  hasOwnInteractiveOrScriptElements,
  normalizeCreativeMarkup,
  validateSafeHttpUrl,
} from '../types/ads';

export type AdFrameRenderStatus =
  | 'loading'
  | 'script_request_started'
  | 'script_loaded'
  | 'iframe_created'
  | 'loaded'
  | 'no_inventory'
  | 'rendering_blocked'
  | 'script_blocked'
  | 'timeout'
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
  const biceaKeyMatch = (ad.scriptCode || '').match(/bicea\.org\/\d+\/([a-f0-9]{16,64})/i);
  const resolvedZoneKey =
    (ad.customPlacementKey && ad.customPlacementKey.trim()) ||
    atMeta.key ||
    (ad.id.startsWith('adsterra_zone_') ? ad.id.slice('adsterra_zone_'.length) : '') ||
    (biceaKeyMatch ? biceaKeyMatch[1] : '') ||
    ad.id;

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
    var zoneKey = ${JSON.stringify(resolvedZoneKey)};
    var configuredWidth = ${JSON.stringify(expectedMinWidth)};
    var configuredHeight = ${JSON.stringify(expectedMinHeight)};
    var isPopunder = ${isPopunder ? 'true' : 'false'};
    var isHttpsParent = ${isHttps ? 'true' : 'false'};
    var providerName = ${JSON.stringify(ad.provider || 'Ad Network')};
    var atFormat = ${JSON.stringify(atMeta.format || '')};
    var probeStartTime = Date.now();

    var externalScripts = [];
    var seenScriptUrls = {};
    var earlyScriptStates = {};
    var trackedElements = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var nestedFrames = [];
    var blockedResources = [];
    var runtimeErrors = [];
    var imageErrors = [];
    var sandboxErrors = [];
    var emittedDiagnostics = {};
    var lastEmittedStatus = '';
    var hasSettledFinal = false;
    var probeDisposed = false;
    var crossOriginSettleTimer = null;
    var graceSettleTimer = null;
    var headMutationObserver = null;
    var nestedBridgeSeq = 0;
    var lastTelemetrySignature = '';
    var ioState = {
      supported: typeof IntersectionObserver !== 'undefined',
      observed: false,
      isIntersecting: null,
      intersectionRatio: null,
      boundingRect: '',
      intersectionRect: ''
    };

    function isOpaqueSandboxOrigin() {
      try {
        return !window.origin || window.origin === 'null';
      } catch (e) {
        return true;
      }
    }

    function isExternalHttpUrl(url) {
      if (typeof url !== 'string') return false;
      var t = url.trim();
      return /^https?:\\/\\//i.test(t) || t.indexOf('//') === 0;
    }

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
      if (!url || /^about:/i.test(url)) return 'about:blank';
      try {
        return new URL(upgradeUrl(url)).hostname || url;
      } catch (e) {
        return String(url || '').slice(0, 80);
      }
    }

    function formatRectStr(r) {
      if (!r) return '0x0';
      return Math.round(r.left || 0) + ',' + Math.round(r.top || 0) + ' ' + Math.round(r.width || 0) + 'x' + Math.round(r.height || 0);
    }

    function resolveOutcomeCategory(eventName, status) {
      if (eventName === 'creative_rendered' || status === 'loaded' || status === 'preview_unsupported' || status === 'popunder_ready') {
        return 'creative_rendered';
      }
      if (eventName === 'empty_response' || status === 'no_inventory') {
        return 'no_inventory';
      }
      if (
        eventName === 'script_failed' ||
        eventName === 'timeout' ||
        eventName === 'browser_restriction' ||
        status === 'script_blocked' ||
        status === 'rendering_blocked' ||
        status === 'timeout' ||
        status === 'error'
      ) {
        return 'blocked_rendering';
      }
      if (eventName === 'nested_iframe_created' || eventName === 'nested_iframe_updated' || status === 'iframe_created') {
        return 'iframe_created';
      }
      return 'script_loaded';
    }

    function lookupScriptResponseStatus(url) {
      if (!url || typeof performance === 'undefined' || !performance.getEntriesByName) {
        return '';
      }
      try {
        var entries = performance.getEntriesByName(url);
        if (entries && entries.length > 0) {
          var last = entries[entries.length - 1];
          if (typeof last.responseStatus === 'number' && last.responseStatus > 0) {
            return 'HTTP ' + last.responseStatus;
          }
        }
      } catch (e) {}
      return '';
    }

    function emitDiagnostic(eventName, status, detail, url, responseStatus, extra) {
      if (probeDisposed || !window.parent) return;
      var resolvedHttpStatus = responseStatus || (url ? lookupScriptResponseStatus(url) : '');
      var isRepeatableTelemetry = eventName === 'frame_telemetry' || eventName === 'nested_iframe_updated';
      var dedupeKey = eventName + '|' + (status || '') + '|' + (url || '') + '|' + (detail || '');
      if (!isRepeatableTelemetry && Object.prototype.hasOwnProperty.call(emittedDiagnostics, dedupeKey)) return;
      emittedDiagnostics[dedupeKey] = true;
      try {
        var payload = {
          type: 'imagelab-ad-diagnostic',
          id: adId,
          zoneKey: zoneKey,
          width: configuredWidth,
          height: configuredHeight,
          event: eventName,
          status: status || '',
          outcomeCategory: resolveOutcomeCategory(eventName, status),
          responseStatus: resolvedHttpStatus,
          detail: detail || '',
          url: url || '',
          elapsedMs: Date.now() - probeStartTime
        };
        if (extra && typeof extra === 'object') {
          if (extra.failureClassification) payload.failureClassification = extra.failureClassification;
          if (extra.nestedIframeDetails) payload.nestedIframeDetails = extra.nestedIframeDetails;
          if (extra.intersectionObserver) payload.intersectionObserver = extra.intersectionObserver;
        }
        window.parent.postMessage(payload, '*');
      } catch (e) {}
    }

    function postStatus(status, height, message, detail) {
      if (probeDisposed || !window.parent) return;
      if (status === lastEmittedStatus && status !== 'loaded') return;
      lastEmittedStatus = status;
      try {
        window.parent.postMessage({
          type: 'imagelab-ad-status',
          id: adId,
          zoneKey: zoneKey,
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

    // 2. Capture-phase load, error & CSP violation listeners (prevents race conditions with early cached/403 script tags)
    window.addEventListener('load', function (ev) {
      if (ev && ev.target && ev.target !== window && ev.target.tagName) {
        var tag = String(ev.target.tagName || '').toLowerCase();
        if (tag === 'script') {
          var sUrl = upgradeUrl((ev.target.getAttribute && ev.target.getAttribute('src')) || ev.target.src || '');
          if (sUrl) {
            earlyScriptStates[sUrl] = 'loaded';
            for (var si = 0; si < externalScripts.length; si++) {
              if (externalScripts[si].el === ev.target || externalScripts[si].url === sUrl) {
                externalScripts[si].status = 'loaded';
              }
            }
            emitDiagnostic(
              'script_loaded',
              'script_loaded',
              'External ad script load event fired; waiting for DOM/iframe output.',
              sUrl,
              lookupScriptResponseStatus(sUrl)
            );
          }
          if (window.__imagelabAdProbe && !probeDisposed) window.__imagelabAdProbe.report(false);
        }
      }
    }, true);

    window.addEventListener('error', function (ev) {
      if (ev && ev.target && ev.target !== window && ev.target.tagName) {
        var tag = String(ev.target.tagName || '').toLowerCase();
        var src = upgradeUrl(ev.target.getAttribute ? (ev.target.getAttribute('src') || '') : '');
        if (tag === 'script' || tag === 'iframe') {
          var failDetail = tag === 'script'
            ? 'Script error event fired (request rejected, blocked by content filter, or network failure; exact cross-origin status unavailable to JS unless exposed)'
            : 'Nested ad frame error event fired';
          if (tag === 'script' && src) {
            earlyScriptStates[src] = 'error';
            for (var si = 0; si < externalScripts.length; si++) {
              if (externalScripts[si].el === ev.target || externalScripts[si].url === src) {
                externalScripts[si].status = 'error';
              }
            }
          }
          blockedResources.push({ tag: tag, url: src, reason: failDetail });
          emitDiagnostic('script_failed', 'script_blocked', failDetail, src, lookupScriptResponseStatus(src));
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
      var reason = 'Blocked by Content Security Policy (' + (ev.violatedDirective || 'policy') + ')';
      blockedResources.push({
        tag: 'csp',
        url: blocked,
        reason: reason
      });
      emitDiagnostic('browser_restriction', 'script_blocked', reason, blocked);
      if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
    });

    function findFrameInfo(el) {
      for (var i = 0; i < nestedFrames.length; i++) {
        if (nestedFrames[i].el === el) return nestedFrames[i];
      }
      return null;
    }

    var nativeContentDocDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
    var nativeContentWinDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');

    function normalizeInlineScriptProtocols(html) {
      if (!isHttpsParent || !html) return html || '';
      return String(html).replace(
        /(<script\\b(?![^>]*\\bsrc\\s*=)[^>]*>)([\\s\\S]*?)(<\\/script>)/gi,
        function (_m, openTag, body, closeTag) {
          var fixedBody = body
            .replace(/\\(\\s*(?:window\\.)?location\\.protocol\\s*===?\\s*(['"])https:\\1\\s*\\?\\s*(['"])s\\2\\s*:\\s*(['"])\\3\\s*\\)/gi, "'s'")
            .replace(/(?:window\\.)?location\\.protocol\\s*===?\\s*(['"])https:\\1\\s*\\?\\s*(['"])https:\\2\\s*:\\s*(['"])http:\\3/gi, "'https:'")
            .replace(/(?:window\\.)?location\\.protocol\\s*===?\\s*(['"])https:\\1/gi, 'true');
          return openTag + fixedBody + closeTag;
        }
      );
    }

    function buildNestedFriendlySrcDoc(frameToken, winState, bodyHtml) {
      var prelude = '';
      var skipKeys = {
        document: 1,
        parent: 1,
        top: 1,
        self: 1,
        window: 1,
        location: 1,
        navigator: 1,
        screen: 1,
        innerWidth: 1,
        innerHeight: 1,
        devicePixelRatio: 1,
        setTimeout: 1,
        clearTimeout: 1,
        setInterval: 1,
        clearInterval: 1,
        addEventListener: 1,
        removeEventListener: 1,
        frameElement: 1,
        console: 1,
        localStorage: 1,
        sessionStorage: 1,
        performance: 1,
        fetch: 1,
        XMLHttpRequest: 1,
        Image: 1,
        Promise: 1,
        MutationObserver: 1,
        IntersectionObserver: 1,
        ResizeObserver: 1,
        getComputedStyle: 1,
        matchMedia: 1,
        requestAnimationFrame: 1,
        cancelAnimationFrame: 1,
        postMessage: 1,
        URL: 1,
        atob: 1,
        btoa: 1,
        JSON: 1,
        encodeURIComponent: 1,
        decodeURIComponent: 1,
        Math: 1,
        Date: 1,
        RegExp: 1,
        Object: 1,
        Array: 1,
        String: 1,
        Number: 1,
        Boolean: 1,
        Error: 1,
        Intl: 1
      };
      if (winState && !Object.prototype.hasOwnProperty.call(winState, 'atOptions') && typeof window.atOptions !== 'undefined') {
        try {
          prelude += 'window.atOptions=' + JSON.stringify(window.atOptions) + ';';
        } catch (atErr) {}
      }
      for (var k in winState) {
        if (!Object.prototype.hasOwnProperty.call(winState, k) || skipKeys[k]) continue;
        if (typeof winState[k] === 'function') continue;
        try {
          prelude += 'window[' + JSON.stringify(k) + ']=' + JSON.stringify(winState[k]) + ';';
        } catch (serErr) {}
      }
      var safeHtml = normalizeInlineScriptProtocols(rewriteHtmlUrls(bodyHtml || ''));
      var reportScript =
        '<script data-imagelab-nested-probe="1">(function(){var tok=' + JSON.stringify(frameToken) + ';' +
        'var peakBodyChild=0;var everHadCreative=false;var lastSig="";var hiddenInfo=null;' +
        'function isNodeProbe(el){return Boolean(el&&el.getAttribute&&el.getAttribute("data-imagelab-nested-probe"));}' +
        'function check(){try{' +
        'var body=document.body;var bodyChildren=body?Array.prototype.filter.call(body.children||[],function(c){return !isNodeProbe(c);}):[];' +
        'var bodyNodes=body?Array.prototype.filter.call(body.childNodes||[],function(c){return c.nodeType!==1||!isNodeProbe(c);}):[];' +
        'if(bodyChildren.length>peakBodyChild)peakBodyChild=bodyChildren.length;' +
        'var scripts=Array.prototype.filter.call(document.querySelectorAll("script"),function(s){return !isNodeProbe(s);});' +
        'var imgs=document.querySelectorAll("img");' +
        'var frms=document.querySelectorAll("iframe");' +
        'var htmlLen=document.documentElement?document.documentElement.innerHTML.length:0;' +
        'var bodyHtmlLen=body?body.innerHTML.length:0;' +
        'var pendingAssets=0;var visRes=null;hiddenInfo=null;' +
        'for(var i=0;i<imgs.length;i++){' +
        'var im=imgs[i];var imCs=getComputedStyle(im);var imR=im.getBoundingClientRect();' +
        'if(!im.complete){pendingAssets++;continue;}' +
        'if(im.naturalWidth>1&&im.naturalHeight>1){' +
        'everHadCreative=true;' +
        'if(imCs.display==="none"||imCs.visibility==="hidden"||parseFloat(imCs.opacity||"1")<=0.02||imR.width<2||imR.height<2){' +
        'hiddenInfo={kind:"image",reason:"img hidden/zero ("+imCs.display+"/"+imCs.visibility+", "+Math.round(imR.width)+"x"+Math.round(imR.height)+")",width:imR.width,height:imR.height};' +
        '}else if(!visRes){visRes={kind:"image",width:imR.width||im.naturalWidth,height:imR.height||im.naturalHeight};}' +
        '}}' +
        'for(var f=0;f<frms.length;f++){' +
        'var fr=frms[f];var s=fr.getAttribute("src")||"";var frCs=getComputedStyle(fr);var frR=fr.getBoundingClientRect();' +
        'if(new RegExp("^https?://","i").test(s)){' +
        'everHadCreative=true;' +
        'if(frCs.display==="none"||frCs.visibility==="hidden"||parseFloat(frCs.opacity||"1")<=0.02||frR.width<2||frR.height<2){' +
        'hiddenInfo=hiddenInfo||{kind:"cross-origin iframe",reason:"iframe hidden/zero ("+frCs.display+"/"+frCs.visibility+", "+Math.round(frR.width)+"x"+Math.round(frR.height)+")",width:frR.width,height:frR.height};' +
        '}else if(!visRes){visRes={crossOriginUrl:s,width:frR.width,height:frR.height};}' +
        '}}' +
        'var all=body?body.querySelectorAll("*"):[];' +
        'for(var j=0;j<all.length;j++){' +
        'var el=all[j];if(isNodeProbe(el))continue;' +
        'var t=(el.tagName||"").toLowerCase();if(t==="script"||t==="style"||t==="meta"||t==="link")continue;' +
        'var cs=getComputedStyle(el);var r=el.getBoundingClientRect?el.getBoundingClientRect():{width:0,height:0};' +
        'var txt=(el.textContent||"").trim();var bg=cs.backgroundImage||"";var hasBg=bg&&bg!=="none"&&bg.indexOf("url(")!==-1;' +
        'var isCreat=txt.length>=2||hasBg||t==="canvas"||t==="svg"||t==="video";' +
        'if(isCreat){everHadCreative=true;' +
        'if(cs.display==="none"||cs.visibility==="hidden"||parseFloat(cs.opacity||"1")<=0.02||r.width<2||r.height<2){' +
        'hiddenInfo=hiddenInfo||{kind:t+" creative",reason:t+" hidden/zero ("+cs.display+"/"+cs.visibility+", "+Math.round(r.width)+"x"+Math.round(r.height)+")",width:r.width,height:r.height};' +
        '}else if(!visRes&&r.width>=10&&r.height>=10){' +
        'visRes={kind:hasBg?"nested styled banner":("nested "+(t==="canvas"||t==="svg"||t==="video"?t:"HTML creative")),width:r.width,height:r.height};' +
        '}}}' +
        'var nonScriptChildren=bodyChildren.filter(function(c){var tg=(c.tagName||"").toLowerCase();return tg!=="script"&&tg!=="style"&&tg!=="meta"&&tg!=="link";});' +
        'var contentRemoved=Boolean((peakBodyChild>0&&bodyChildren.length===0)||(everHadCreative&&nonScriptChildren.length===0&&imgs.length===0&&frms.length===0));' +
        'var payload={type:"imagelab-nested-frame-report",token:tok,readyState:document.readyState,htmlLength:htmlLen,bodyHtmlLength:bodyHtmlLen,bodyChildCount:bodyChildren.length,bodyNodeCount:bodyNodes.length,peakBodyChildCount:peakBodyChild,scriptCount:scripts.length,imgCount:imgs.length,childIframeCount:frms.length,pendingAssets:pendingAssets,contentRemoved:contentRemoved};' +
        'if(visRes&&visRes.crossOriginUrl){payload.crossOriginUrl=visRes.crossOriginUrl;}' +
        'else if(visRes){payload.visible=true;payload.kind=visRes.kind;payload.width=visRes.width;payload.height=visRes.height;}' +
        'else if(hiddenInfo){payload.hiddenCreative=hiddenInfo;}' +
        'var sig=JSON.stringify(payload);if(sig!==lastSig){lastSig=sig;window.parent.postMessage(payload,"*");}' +
        '}catch(e){}}' +
        'window.addEventListener("error",function(ev){if(ev&&ev.target&&ev.target!==window){window.parent.postMessage({type:"imagelab-nested-frame-report",token:tok,blocked:"Nested ad resource blocked or failed"},"*");}else if(ev&&ev.message){window.parent.postMessage({type:"imagelab-nested-frame-report",token:tok,blocked:"Nested frame runtime error: "+String(ev.message).slice(0,120)},"*");}},true);' +
        'window.addEventListener("securitypolicyviolation",function(ev){window.parent.postMessage({type:"imagelab-nested-frame-report",token:tok,blocked:"Nested frame CSP violation: "+(ev.violatedDirective||"policy")},"*");});' +
        'if(typeof MutationObserver!=="undefined"&&document.documentElement){new MutationObserver(function(){check();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true});}' +
        'if(typeof ResizeObserver!=="undefined"&&document.documentElement){new ResizeObserver(function(){check();}).observe(document.documentElement);}' +
        '[80,350,1000,2500,5000,8500,12000].forEach(function(ms){setTimeout(check,ms);});' +
        'window.addEventListener("load",function(){setTimeout(check,60);});check();})();<' + '/script>';
      var headPrelude = prelude ? '<script data-imagelab-nested-probe="1">' + prelude + '<' + '/script>' : '';
      if (/<html\\b/i.test(safeHtml)) {
        var outHtml = safeHtml;
        if (headPrelude) {
          outHtml = /<head\\b[^>]*>/i.test(outHtml)
            ? outHtml.replace(/(<head\\b[^>]*>)/i, '$1' + headPrelude)
            : outHtml.replace(/(<html\\b[^>]*>)/i, '$1<head>' + headPrelude + '</head>');
        }
        if (/<\\/body>/i.test(outHtml)) {
          outHtml = outHtml.replace(/<\\/body>/i, reportScript + '</body>');
        } else {
          outHtml += reportScript;
        }
        return outHtml;
      }
      return '<!DOCTYPE html><html><head><meta charset="utf-8"/><base target="_blank" rel="noopener noreferrer"/>' + headPrelude + '</head><body style="margin:0;padding:0;background:transparent;">' + safeHtml + reportScript + '</body></html>';
    }

    window.addEventListener('message', function (ev) {
      var data = ev && ev.data;
      if (!data || data.type !== 'imagelab-nested-frame-report' || !data.token) return;
      for (var i = 0; i < nestedFrames.length; i++) {
        var fi = nestedFrames[i];
        if (fi.token === data.token) {
          if (typeof data.readyState === 'string') fi.nestedReadyState = data.readyState;
          if (typeof data.htmlLength === 'number') fi.nestedHtmlLength = data.htmlLength;
          if (typeof data.bodyHtmlLength === 'number') fi.nestedBodyHtmlLength = data.bodyHtmlLength;
          if (typeof data.bodyChildCount === 'number') fi.nestedBodyChildCount = data.bodyChildCount;
          if (typeof data.peakBodyChildCount === 'number') fi.nestedPeakBodyChildCount = Math.max(fi.nestedPeakBodyChildCount || 0, data.peakBodyChildCount);
          if (typeof data.scriptCount === 'number') fi.nestedScriptCount = data.scriptCount;
          if (typeof data.imgCount === 'number') fi.nestedImgCount = data.imgCount;
          if (typeof data.childIframeCount === 'number') fi.nestedChildIframeCount = data.childIframeCount;
          if (typeof data.pendingAssets === 'number') fi.nestedPendingAssets = data.pendingAssets;
          if (data.contentRemoved) fi.nestedContentRemoved = true;
          if (data.hiddenCreative && data.hiddenCreative.kind) {
            fi.nestedHiddenCreative = data.hiddenCreative;
          }
          if (data.visible) {
            fi.nestedVisible = true;
            fi.nestedKind = data.kind || 'nested iframe creative';
            fi.nestedWidth = Number(data.width || 0);
            fi.nestedHeight = Number(data.height || 0);
          }
          if (data.crossOriginUrl && isExternalHttpUrl(data.crossOriginUrl)) {
            fi.nestedCrossOriginUrl = data.crossOriginUrl;
          }
          if (data.blocked) {
            fi.nestedBlocked = String(data.blocked);
            sandboxErrors.push(String(data.blocked));
          }
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
          break;
        }
      }
    });

    function installFriendlyBlankIframeBridge(el) {
      if (!isOpaqueSandboxOrigin() || !el || el.__imagelabBridgeInstalled) return;
      el.__imagelabBridgeInstalled = true;
      var existingSrc = (el.getAttribute && el.getAttribute('src')) || '';
      var token = 'nf_' + (++nestedBridgeSeq);
      var shadowDoc = null;
      try {
        if (document.implementation && document.implementation.createHTMLDocument) {
          shadowDoc = document.implementation.createHTMLDocument('');
        }
      } catch (sdErr) {}

      var state = {
        token: token,
        hasRemoteSrc: isExternalHttpUrl(existingSrc),
        writeChunks: [],
        wroteBuffer: '',
        flushTimer: null,
        winState: {},
        flushed: false,
        flushCount: 0,
        lastFlushedSrcDoc: '',
        srcdocBytes: 0,
        openCount: 0,
        writeCallCount: 0,
        closeCount: 0,
        rawBytesWritten: 0,
        domAppendCount: 0,
        peakDomChildren: 0,
        hadScriptTag: false,
        hadImgTag: false,
        hadChildIframeTag: false,
        readyState: 'loading',
        shadowDoc: shadowDoc,
        flushBlockedError: '',
        loadListeners: []
      };
      el.__imagelabBridgeState = state;

      function serializeShadowBodyAndHead() {
        if (!shadowDoc) return '';
        var h = shadowDoc.head ? shadowDoc.head.innerHTML : '';
        var b = shadowDoc.body ? shadowDoc.body.innerHTML : '';
        if (!h && !b) return '';
        return (h ? '<head>' + h + '</head>' : '') + (b ? '<body>' + b + '</body>' : '');
      }

      function computeCombinedHtml() {
        var written = state.writeChunks.join('');
        var domPart = serializeShadowBodyAndHead();
        if (written && domPart) return written + domPart;
        return written || domPart || state.wroteBuffer || '';
      }

      function inspectBufferTags(htmlStr) {
        if (!htmlStr) return;
        if (/<script\\b/i.test(htmlStr)) state.hadScriptTag = true;
        if (/<img\\b/i.test(htmlStr)) state.hadImgTag = true;
        if (/<iframe\\b/i.test(htmlStr)) state.hadChildIframeTag = true;
      }

      function flushToSrcDoc() {
        if (state.hasRemoteSrc) return;
        if (state.flushTimer) {
          clearTimeout(state.flushTimer);
          state.flushTimer = null;
        }
        var existingInfo = findFrameInfo(el);
        if (existingInfo) existingInfo.token = token;
        if (shadowDoc && shadowDoc.body && shadowDoc.body.children) {
          state.peakDomChildren = Math.max(state.peakDomChildren, shadowDoc.body.children.length);
        }
        var combined = computeCombinedHtml();
        if (combined) state.wroteBuffer = combined;
        inspectBufferTags(combined);
        if (!combined && !state.openCount && !state.flushed) return;
        var nextSrcDoc = buildNestedFriendlySrcDoc(token, state.winState, combined);
        if (nextSrcDoc === state.lastFlushedSrcDoc) return;
        state.lastFlushedSrcDoc = nextSrcDoc;
        state.flushed = true;
        state.flushCount += 1;
        state.srcdocBytes = nextSrcDoc.length;
        if (existingInfo) {
          existingInfo.loadFired = false;
          existingInfo.lastFlushMs = Date.now();
        }
        try {
          el.setAttribute('srcdoc', nextSrcDoc);
          state.readyState = 'complete';
          for (var li = 0; li < state.loadListeners.length; li++) {
            try { state.loadListeners[li](); } catch (le) {}
          }
        } catch (err) {
          state.flushBlockedError = 'Nested about:blank iframe srcdoc write blocked by sandbox restrictions';
          sandboxErrors.push(state.flushBlockedError);
        }
      }

      function scheduleFlush() {
        if (state.hasRemoteSrc || state.flushTimer) return;
        if (shadowDoc && shadowDoc.body && shadowDoc.body.children) {
          state.peakDomChildren = Math.max(state.peakDomChildren, shadowDoc.body.children.length);
        }
        state.flushTimer = setTimeout(flushToSrcDoc, 45);
      }

      if (shadowDoc && typeof MutationObserver !== 'undefined' && shadowDoc.documentElement) {
        try {
          var shadowMo = new MutationObserver(function (muts) {
            if (shadowDoc.body && shadowDoc.body.children) {
              state.peakDomChildren = Math.max(state.peakDomChildren, shadowDoc.body.children.length);
            }
            for (var mi = 0; mi < muts.length; mi++) {
              if (muts[mi].addedNodes && muts[mi].addedNodes.length > 0) {
                state.domAppendCount += muts[mi].addedNodes.length;
              }
            }
            scheduleFlush();
          });
          shadowMo.observe(shadowDoc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
        } catch (moErr) {}
      }

      var fallbackBodyHtml = '';
      var virtualBody = shadowDoc && shadowDoc.body ? shadowDoc.body : {
        nodeType: 1,
        nodeName: 'BODY',
        tagName: 'BODY',
        style: {},
        childNodes: [],
        children: [],
        childElementCount: 0,
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        appendChild: function (child) {
          if (child) virtualBody.childNodes.push(child);
          state.domAppendCount += 1;
          if (child && child.outerHTML) state.wroteBuffer += child.outerHTML;
          else if (child && child.nodeValue) state.wroteBuffer += String(child.nodeValue);
          scheduleFlush();
          return child;
        },
        insertBefore: function (child) {
          if (child) virtualBody.childNodes.unshift(child);
          state.domAppendCount += 1;
          if (child && child.outerHTML) state.wroteBuffer += child.outerHTML;
          else if (child && child.nodeValue) state.wroteBuffer += String(child.nodeValue);
          scheduleFlush();
          return child;
        },
        append: function () {
          for (var i = 0; i < arguments.length; i++) virtualBody.appendChild(arguments[i]);
        },
        insertAdjacentHTML: function (_pos, html) {
          state.wroteBuffer += String(html || '');
          state.domAppendCount += 1;
          scheduleFlush();
        }
      };
      if (!shadowDoc) {
        Object.defineProperty(virtualBody, 'innerHTML', {
          configurable: true,
          get: function () { return fallbackBodyHtml; },
          set: function (val) {
            fallbackBodyHtml = String(val || '');
            state.wroteBuffer += fallbackBodyHtml;
            scheduleFlush();
          }
        });
      }

      var virtualHead = shadowDoc && shadowDoc.head ? shadowDoc.head : {
        style: {},
        innerHTML: '',
        childNodes: [],
        children: [],
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        appendChild: function (child) {
          state.domAppendCount += 1;
          if (child && child.outerHTML) state.wroteBuffer += child.outerHTML;
          scheduleFlush();
          return child;
        },
        insertBefore: function (child) {
          state.domAppendCount += 1;
          if (child && child.outerHTML) state.wroteBuffer += child.outerHTML;
          scheduleFlush();
          return child;
        }
      };
      var virtualHtml = shadowDoc && shadowDoc.documentElement ? shadowDoc.documentElement : {
        style: {},
        appendChild: function (child) {
          state.domAppendCount += 1;
          if (child && child.outerHTML) state.wroteBuffer += child.outerHTML;
          scheduleFlush();
          return child;
        }
      };

      var docListeners = {};
      var virtualDoc = {
        __isVirtualBridgeDoc: true,
        get readyState() { return state.readyState; },
        get head() { return (shadowDoc && shadowDoc.head) || virtualHead; },
        get body() { return (shadowDoc && shadowDoc.body) || virtualBody; },
        get documentElement() { return (shadowDoc && shadowDoc.documentElement) || virtualHtml; },
        title: '',
        cookie: '',
        referrer: '',
        URL: 'about:blank',
        domain: '',
        characterSet: 'UTF-8',
        compatMode: 'CSS1Compat',
        currentScript: null,
        open: function () {
          state.openCount += 1;
          state.readyState = 'loading';
          state.writeChunks = [];
          state.wroteBuffer = '';
          if (shadowDoc) {
            try {
              if (shadowDoc.head) shadowDoc.head.innerHTML = '';
              if (shadowDoc.body) shadowDoc.body.innerHTML = '';
            } catch (e) {}
          }
          return virtualDoc;
        },
        write: function () {
          var chunk = Array.prototype.join.call(arguments, '');
          state.writeCallCount += 1;
          state.rawBytesWritten += chunk.length;
          state.writeChunks.push(chunk);
          state.wroteBuffer = computeCombinedHtml();
          inspectBufferTags(chunk);
          scheduleFlush();
        },
        writeln: function () {
          var chunk = Array.prototype.join.call(arguments, '') + '\\n';
          state.writeCallCount += 1;
          state.rawBytesWritten += chunk.length;
          state.writeChunks.push(chunk);
          state.wroteBuffer = computeCombinedHtml();
          inspectBufferTags(chunk);
          scheduleFlush();
        },
        close: function () {
          state.closeCount += 1;
          state.readyState = 'interactive';
          flushToSrcDoc();
        },
        createElement: function (tag) {
          return shadowDoc ? shadowDoc.createElement(tag) : nativeCreateElement(tag);
        },
        createElementNS: function (ns, tag) {
          return shadowDoc ? shadowDoc.createElementNS(ns, tag) : document.createElementNS(ns, tag);
        },
        createTextNode: function (txt) {
          return shadowDoc ? shadowDoc.createTextNode(txt) : document.createTextNode(txt);
        },
        createComment: function (txt) {
          return shadowDoc ? shadowDoc.createComment(txt) : document.createComment(txt);
        },
        createDocumentFragment: function () {
          return shadowDoc ? shadowDoc.createDocumentFragment() : document.createDocumentFragment();
        },
        createRange: function () {
          return shadowDoc && shadowDoc.createRange ? shadowDoc.createRange() : document.createRange();
        },
        adoptNode: function (n) {
          return shadowDoc && shadowDoc.adoptNode ? shadowDoc.adoptNode(n) : n;
        },
        importNode: function (n, deep) {
          return shadowDoc && shadowDoc.importNode ? shadowDoc.importNode(n, deep) : n;
        },
        implementation: document.implementation,
        getElementById: function (id) {
          return shadowDoc ? shadowDoc.getElementById(id) : null;
        },
        querySelector: function (sel) {
          return shadowDoc ? shadowDoc.querySelector(sel) : null;
        },
        querySelectorAll: function (sel) {
          return shadowDoc ? shadowDoc.querySelectorAll(sel) : [];
        },
        getElementsByTagName: function (tag) {
          if (shadowDoc) return shadowDoc.getElementsByTagName(tag);
          var l = String(tag || '').toLowerCase();
          if (l === 'head') return [virtualHead];
          if (l === 'body') return [virtualBody];
          if (l === 'html') return [virtualHtml];
          return [];
        },
        getElementsByClassName: function (cls) {
          return shadowDoc ? shadowDoc.getElementsByClassName(cls) : [];
        },
        get scripts() { return shadowDoc ? shadowDoc.scripts : []; },
        get images() { return shadowDoc ? shadowDoc.images : []; },
        get links() { return shadowDoc ? shadowDoc.links : []; },
        get forms() { return shadowDoc ? shadowDoc.forms : []; },
        addEventListener: function (ev, fn) {
          if (!docListeners[ev]) docListeners[ev] = [];
          docListeners[ev].push(fn);
          if (ev === 'DOMContentLoaded' && state.readyState === 'complete' && typeof fn === 'function') {
            setTimeout(fn, 0);
          }
        },
        removeEventListener: function (ev, fn) {
          if (!docListeners[ev]) return;
          docListeners[ev] = docListeners[ev].filter(function (f) { return f !== fn; });
        },
        dispatchEvent: function () { return true; }
      };

      var virtualWin = state.winState;
      virtualWin.document = virtualDoc;
      virtualWin.parent = window;
      virtualWin.self = virtualWin;
      virtualWin.window = virtualWin;
      virtualWin.top = window;
      if (typeof window.atOptions !== 'undefined' && typeof virtualWin.atOptions === 'undefined') {
        try { virtualWin.atOptions = JSON.parse(JSON.stringify(window.atOptions)); } catch (e) {}
      }
      virtualWin.location = {
        href: 'about:blank',
        protocol: isHttpsParent ? 'https:' : 'http:',
        host: '',
        hostname: '',
        origin: 'null',
        pathname: 'blank',
        search: '',
        hash: ''
      };
      virtualWin.navigator = window.navigator;
      virtualWin.screen = window.screen;
      virtualWin.innerWidth = window.innerWidth;
      virtualWin.innerHeight = window.innerHeight;
      virtualWin.devicePixelRatio = window.devicePixelRatio || 1;
      virtualWin.setTimeout = window.setTimeout.bind(window);
      virtualWin.clearTimeout = window.clearTimeout.bind(window);
      virtualWin.setInterval = window.setInterval.bind(window);
      virtualWin.clearInterval = window.clearInterval.bind(window);
      virtualWin.requestAnimationFrame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (cb) { return setTimeout(cb, 16); };
      virtualWin.cancelAnimationFrame = window.cancelAnimationFrame ? window.cancelAnimationFrame.bind(window) : clearTimeout;
      virtualWin.getComputedStyle = window.getComputedStyle ? window.getComputedStyle.bind(window) : undefined;
      virtualWin.matchMedia = window.matchMedia ? window.matchMedia.bind(window) : undefined;
      virtualWin.postMessage = window.postMessage.bind(window);
      virtualWin.fetch = window.fetch ? window.fetch.bind(window) : undefined;
      virtualWin.XMLHttpRequest = window.XMLHttpRequest;
      virtualWin.Image = window.Image;
      virtualWin.URL = window.URL;
      virtualWin.Promise = window.Promise;
      virtualWin.JSON = window.JSON;
      virtualWin.atob = window.atob ? window.atob.bind(window) : undefined;
      virtualWin.btoa = window.btoa ? window.btoa.bind(window) : undefined;
      virtualWin.encodeURIComponent = window.encodeURIComponent;
      virtualWin.decodeURIComponent = window.decodeURIComponent;
      virtualWin.MutationObserver = window.MutationObserver;
      virtualWin.IntersectionObserver = window.IntersectionObserver;
      virtualWin.ResizeObserver = window.ResizeObserver;
      virtualWin.performance = window.performance;
      virtualWin.console = window.console;
      virtualWin.localStorage = window.localStorage;
      virtualWin.sessionStorage = window.sessionStorage;
      virtualWin.frameElement = el;
      virtualWin.addEventListener = function (ev, fn) {
        if (ev === 'load' && typeof fn === 'function') state.loadListeners.push(fn);
      };
      virtualWin.removeEventListener = function (ev, fn) {
        if (ev === 'load') state.loadListeners = state.loadListeners.filter(function (f) { return f !== fn; });
      };
      virtualDoc.defaultView = virtualWin;

      state.virtualDoc = virtualDoc;
      state.virtualWin = virtualWin;

      try {
        Object.defineProperty(el, 'contentDocument', {
          configurable: true,
          get: function () {
            if (state.hasRemoteSrc) {
              return nativeContentDocDesc && nativeContentDocDesc.get ? nativeContentDocDesc.get.call(el) : null;
            }
            return virtualDoc;
          }
        });
        Object.defineProperty(el, 'contentWindow', {
          configurable: true,
          get: function () {
            if (state.hasRemoteSrc) {
              return nativeContentWinDesc && nativeContentWinDesc.get ? nativeContentWinDesc.get.call(el) : null;
            }
            return virtualWin;
          }
        });
      } catch (defErr) {
        sandboxErrors.push('Browser prevented friendly-iframe isolation bridge on about:blank frame');
      }
    }

    if (isOpaqueSandboxOrigin() && typeof HTMLIFrameElement !== 'undefined' && nativeContentDocDesc && nativeContentDocDesc.configurable) {
      try {
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
          configurable: true,
          get: function () {
            var s = (this.getAttribute && this.getAttribute('src')) || '';
            if (isExternalHttpUrl(s)) {
              return nativeContentDocDesc.get ? nativeContentDocDesc.get.call(this) : null;
            }
            if (!this.__imagelabBridgeInstalled) {
              installFriendlyBlankIframeBridge(this);
            }
            if (this.__imagelabBridgeState && !this.__imagelabBridgeState.hasRemoteSrc) {
              return this.__imagelabBridgeState.virtualDoc;
            }
            return nativeContentDocDesc.get ? nativeContentDocDesc.get.call(this) : null;
          }
        });
        Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
          configurable: true,
          get: function () {
            var s = (this.getAttribute && this.getAttribute('src')) || '';
            if (isExternalHttpUrl(s)) {
              return nativeContentWinDesc && nativeContentWinDesc.get ? nativeContentWinDesc.get.call(this) : null;
            }
            if (!this.__imagelabBridgeInstalled) {
              installFriendlyBlankIframeBridge(this);
            }
            if (this.__imagelabBridgeState && !this.__imagelabBridgeState.hasRemoteSrc) {
              return this.__imagelabBridgeState.virtualWin;
            }
            return nativeContentWinDesc && nativeContentWinDesc.get ? nativeContentWinDesc.get.call(this) : null;
          }
        });
      } catch (protoErr) {}
    }

    function disableBlankBridgeIfRemote(el, url) {
      var st = el && el.__imagelabBridgeState;
      if (!st) return;
      if (isExternalHttpUrl(url)) {
        st.hasRemoteSrc = true;
        if (st.flushTimer) {
          clearTimeout(st.flushTimer);
          st.flushTimer = null;
        }
        try {
          if (el.hasAttribute && el.hasAttribute('srcdoc')) el.removeAttribute('srcdoc');
        } catch (e) {}
      } else if (/^javascript:/i.test(String(url || '').trim())) {
        var code = String(url).trim().slice('javascript:'.length);
        try {
          el.setAttribute('srcdoc', buildNestedFriendlySrcDoc(st.token, st.winState, '<script>' + code + '<' + '/script>'));
        } catch (e) {}
      }
    }

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
        if (upgraded && Object.prototype.hasOwnProperty.call(seenScriptUrls, upgraded)) {
          // Prevent duplicate injection of the exact same ad script URL inside one frame
          if (el.parentNode && seenScriptUrls[upgraded] !== el) {
            try { el.parentNode.removeChild(el); } catch (e) {}
          }
          return;
        }
        if (upgraded) seenScriptUrls[upgraded] = el;
        var initialStatus = (upgraded && earlyScriptStates[upgraded]) || 'pending';
        var entry = { el: el, url: upgraded, status: initialStatus };
        externalScripts.push(entry);
        emitDiagnostic(
          'script_element_created',
          'script_request_started',
          'Created external <script> element for zone ' + zoneKey,
          upgraded
        );
        emitDiagnostic(
          'script_request_started',
          'script_request_started',
          'Requesting external ad script for zone ' + zoneKey,
          upgraded
        );
        postStatus(
          'script_request_started',
          0,
          'Script request started: ' + upgraded
        );
        if (initialStatus === 'loaded') {
          emitDiagnostic(
            'script_loaded',
            'script_loaded',
            'External ad script load event fired; waiting for DOM/iframe output.',
            entry.url,
            lookupScriptResponseStatus(entry.url)
          );
        } else if (initialStatus === 'error') {
          emitDiagnostic(
            'script_failed',
            'script_blocked',
            'Script error event fired (request rejected, blocked by content filter, or network failure; exact cross-origin status unavailable to JS unless exposed)',
            entry.url,
            lookupScriptResponseStatus(entry.url)
          );
        }
        el.addEventListener('load', function () {
          entry.status = 'loaded';
          emitDiagnostic(
            'script_loaded',
            'script_loaded',
            'External ad script load event fired; waiting for DOM/iframe output.',
            entry.url,
            lookupScriptResponseStatus(entry.url)
          );
          if (window.__imagelabAdProbe && !probeDisposed) window.__imagelabAdProbe.report(false);
        });
        el.addEventListener('error', function () {
          entry.status = 'error';
          var failReason = 'Script error event fired (request rejected, blocked by content filter, or network failure; exact cross-origin status unavailable to JS unless exposed)';
          blockedResources.push({ tag: 'script', url: entry.url, reason: failReason });
          emitDiagnostic('script_failed', 'script_blocked', failReason, entry.url, lookupScriptResponseStatus(entry.url));
          if (window.__imagelabAdProbe && !probeDisposed) window.__imagelabAdProbe.report(false);
        });
      } else if (tag === 'iframe') {
        var fSrc = el.getAttribute('src') || '';
        var fUpgraded = upgradeUrl(fSrc);
        if (fUpgraded && fUpgraded !== fSrc) {
          try { el.setAttribute('src', fUpgraded); } catch (e) {}
        }
        if (!isExternalHttpUrl(fUpgraded)) {
          installFriendlyBlankIframeBridge(el);
        }
        disableBlankBridgeIfRemote(el, fUpgraded);
        var bState = el.__imagelabBridgeState;
        var frameInfo = {
          el: el,
          token: bState ? bState.token : '',
          src: fUpgraded,
          host: isExternalHttpUrl(fUpgraded) ? extractHost(fUpgraded) : 'about:blank',
          loadFired: false,
          errorFired: false,
          lastFlushMs: 0,
          nestedVisible: false,
          nestedKind: '',
          nestedWidth: 0,
          nestedHeight: 0,
          nestedCrossOriginUrl: '',
          nestedBlocked: '',
          nestedReadyState: '',
          nestedHtmlLength: 0,
          nestedBodyHtmlLength: 0,
          nestedBodyChildCount: 0,
          nestedPeakBodyChildCount: 0,
          nestedScriptCount: 0,
          nestedImgCount: 0,
          nestedChildIframeCount: 0,
          nestedPendingAssets: 0,
          nestedContentRemoved: false,
          nestedHiddenCreative: null
        };
        nestedFrames.push(frameInfo);
        emitDiagnostic(
          'nested_iframe_created',
          'iframe_created',
          'Nested ad iframe created (' + (frameInfo.src || 'about:blank') + ')',
          frameInfo.src || 'about:blank'
        );
        el.addEventListener('load', function () {
          frameInfo.loadFired = true;
          var latestSrc = (el.getAttribute && el.getAttribute('src')) || frameInfo.src;
          if (latestSrc) {
            frameInfo.src = latestSrc;
            frameInfo.host = isExternalHttpUrl(latestSrc) ? extractHost(latestSrc) : 'about:blank';
          }
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
        });
        el.addEventListener('error', function () {
          frameInfo.errorFired = true;
          var latestSrc = (el.getAttribute && el.getAttribute('src')) || frameInfo.src;
          var fFail = 'Nested ad frame failed or blocked';
          blockedResources.push({ tag: 'iframe', url: latestSrc || 'nested frame', reason: fFail });
          emitDiagnostic('script_failed', 'script_blocked', fFail, latestSrc || 'about:blank');
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
      headMutationObserver = new MutationObserver(function (mutations) {
        if (probeDisposed) return;
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
      });
      headMutationObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Observe CORS / fetch failures inside opaque sandbox without altering requests
    if (typeof window.fetch === 'function') {
      var nativeFetch = window.fetch.bind(window);
      window.fetch = function (input, init) {
        return nativeFetch(input, init).then(function (resp) {
          if (resp && !resp.ok && (resp.status === 403 || resp.status === 401)) {
            var urlStr = typeof input === 'string' ? input : (input && input.url) || '';
            var httpErr = 'HTTP ' + resp.status + ' from ' + extractHost(urlStr);
            sandboxErrors.push(httpErr);
            emitDiagnostic('browser_restriction', 'rendering_blocked', httpErr, urlStr);
            if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
          }
          return resp;
        }).catch(function (err) {
          var urlStr = typeof input === 'string' ? input : (input && input.url) || '';
          var corsErr = 'Network or CORS Origin:null failure fetching ' + extractHost(urlStr);
          sandboxErrors.push(corsErr);
          emitDiagnostic('browser_restriction', 'rendering_blocked', corsErr, urlStr);
          if (window.__imagelabAdProbe) window.__imagelabAdProbe.report(false);
          throw err;
        });
      };
    }

    // 3. Safe createElement & document.write wrapper (upgrades Mixed Content URLs and provides friendly about:blank srcdoc bridge)
    var nativeCreateElement = document.createElement.bind(document);
    document.createElement = function (tagName, options) {
      var el = nativeCreateElement(tagName, options);
      var lower = String(tagName || '').toLowerCase();
      if (lower === 'script' || lower === 'iframe' || lower === 'img') {
        if (lower === 'iframe') {
          installFriendlyBlankIframeBridge(el);
        }
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
                var nextV = upgradeUrl(String(v || ''));
                if (lower === 'iframe') disableBlankBridgeIfRemote(el, nextV);
                srcDesc.set.call(el, nextV);
                var existingFi = findFrameInfo(el);
                if (existingFi && nextV && existingFi.src !== nextV) {
                  existingFi.src = nextV;
                  existingFi.host = isExternalHttpUrl(nextV) ? extractHost(nextV) : 'about:blank';
                  existingFi.loadFired = false;
                  emitDiagnostic('nested_iframe_updated', 'iframe_created', 'Nested ad iframe src updated (' + nextV + ')', nextV);
                }
                trackElement(el);
              }
            });
          } catch (e) {}
        }
        if (el.setAttribute) {
          var origSetAttr = el.setAttribute.bind(el);
          el.setAttribute = function (name, val) {
            var isSrcAttr = String(name || '').toLowerCase() === 'src';
            var nextVal = isSrcAttr ? upgradeUrl(String(val || '')) : val;
            if (isSrcAttr && lower === 'iframe') disableBlankBridgeIfRemote(el, String(nextVal || ''));
            origSetAttr(name, nextVal);
            if (isSrcAttr) {
              var existingFi = findFrameInfo(el);
              if (existingFi && nextVal && existingFi.src !== String(nextVal)) {
                existingFi.src = String(nextVal);
                existingFi.host = isExternalHttpUrl(String(nextVal)) ? extractHost(String(nextVal)) : 'about:blank';
                existingFi.loadFired = false;
                emitDiagnostic('nested_iframe_updated', 'iframe_created', 'Nested ad iframe src updated (' + String(nextVal) + ')', String(nextVal));
              }
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
      if (!container || typeof container.querySelectorAll !== 'function') {
        return { visible: false, kind: '', width: 0, height: 0, crossOriginFrames: [], emptyBlankFrames: 0, brokenImages: [], hiddenCreatives: [] };
      }
      var crossOrigin = [];
      var emptySameOrigin = 0;
      var brokenImages = [];
      var hiddenCreatives = [];

      var all = container.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.getAttribute && el.getAttribute('data-imagelab-probe')) continue;
        var tag = el.tagName ? el.tagName.toLowerCase() : '';
        if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'meta' || tag === 'link') {
          continue;
        }
        if (tag === 'img' && el.complete && el.naturalWidth === 0) {
          brokenImages.push(el.getAttribute('src') || 'image resource');
          continue;
        }

        var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
        var cs = null;
        try { cs = (docRef.defaultView || window).getComputedStyle(el); } catch (e) {}
        var isElVisible = isElementRenderedVisible(el);

        if (tag === 'iframe') {
          // NEVER treat an <iframe> tag or empty about:blank frame as rendered visible creative!
          var matchedInfo = findFrameInfo(el);
          if (matchedInfo && matchedInfo.nestedVisible) {
            if (!isElVisible) {
              hiddenCreatives.push({
                kind: matchedInfo.nestedKind || 'nested iframe creative',
                reason: 'Nested iframe has creative (' + Math.round(matchedInfo.nestedWidth) + 'x' + Math.round(matchedInfo.nestedHeight) + ') but outer iframe element is hidden/0px (' + (cs ? cs.display + '/' + cs.visibility : 'unknown') + ', ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')'
              });
              continue;
            }
            return {
              visible: true,
              kind: matchedInfo.nestedKind || 'nested iframe creative',
              width: matchedInfo.nestedWidth || rect.width,
              height: matchedInfo.nestedHeight || rect.height,
              crossOriginFrames: crossOrigin,
              emptyBlankFrames: emptySameOrigin,
              brokenImages: brokenImages,
              hiddenCreatives: hiddenCreatives
            };
          }
          if (matchedInfo && matchedInfo.nestedHiddenCreative) {
            hiddenCreatives.push(matchedInfo.nestedHiddenCreative);
          }

          var sameOriginDoc = null;
          var isCrossOriginSecurityError = false;
          try {
            sameOriginDoc = el.contentDocument || (el.contentWindow && el.contentWindow.document) || null;
          } catch (frameErr) {
            isCrossOriginSecurityError = true;
          }
          if (sameOriginDoc && sameOriginDoc.body && !sameOriginDoc.__isVirtualBridgeDoc) {
            var nestedCheck = inspectContainerDom(sameOriginDoc.body, sameOriginDoc);
            if (nestedCheck.hiddenCreatives && nestedCheck.hiddenCreatives.length > 0) {
              hiddenCreatives = hiddenCreatives.concat(nestedCheck.hiddenCreatives);
            }
            if (nestedCheck.visible) {
              if (!isElVisible) {
                hiddenCreatives.push({
                  kind: nestedCheck.kind || 'nested iframe creative',
                  reason: 'Same-origin iframe has creative but iframe element is hidden/0px'
                });
                continue;
              }
              return nestedCheck;
            }
            emptySameOrigin += 1;
          } else {
            var fSrc = el.getAttribute('src') || '';
            var nestedUrl = (matchedInfo && matchedInfo.nestedCrossOriginUrl) || '';
            if (isExternalHttpUrl(nestedUrl)) {
              if (!isElVisible) {
                hiddenCreatives.push({ kind: 'cross-origin iframe', reason: 'Cross-origin frame hidden/0px (' + extractHost(nestedUrl) + ')' });
              } else {
                crossOrigin.push({ host: extractHost(nestedUrl), src: nestedUrl, width: rect.width, height: rect.height });
              }
            } else if (isExternalHttpUrl(fSrc)) {
              if (!isElVisible) {
                hiddenCreatives.push({ kind: 'cross-origin iframe', reason: 'Cross-origin frame hidden/0px (' + extractHost(fSrc) + ')' });
              } else {
                crossOrigin.push({ host: extractHost(fSrc), src: fSrc, width: rect.width, height: rect.height });
              }
            } else {
              // Empty about:blank iframe (either unfilled or blocked by opaque sandbox)
              if (isCrossOriginSecurityError) {
                sandboxErrors.push('Nested about:blank iframe contentDocument blocked by sandbox isolation');
              }
              emptySameOrigin += 1;
            }
          }
          continue;
        }

        if (!isElVisible) {
          if (tag === 'img' && el.complete && el.naturalWidth > 1) {
            hiddenCreatives.push({ kind: 'image', reason: 'Loaded image (' + el.naturalWidth + 'x' + el.naturalHeight + ') is hidden (' + (cs ? cs.display + '/' + cs.visibility : '') + ', rect=' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')' });
          } else if (tag === 'canvas' || tag === 'svg' || tag === 'video') {
            hiddenCreatives.push({ kind: tag, reason: tag + ' element is hidden/0px' });
          }
          continue;
        }

        if (tag === 'img') {
          if (el.complete && el.naturalWidth > 1 && el.naturalHeight > 1 && rect.width >= 8 && rect.height >= 8) {
            return { visible: true, kind: 'image', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
          }
          continue;
        }

        if (tag === 'svg') {
          if (rect.width >= 16 && rect.height >= 16 && el.querySelector('path, rect, circle, ellipse, polygon, polyline, text, image')) {
            return { visible: true, kind: 'vector graphic', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
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
              return { visible: true, kind: 'canvas creative', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
            }
          }
          continue;
        }

        if (tag === 'video') {
          if (rect.width >= 16 && rect.height >= 16 && el.readyState >= 2 && el.videoWidth > 0) {
            return { visible: true, kind: 'video', width: rect.width, height: rect.height, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
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
              emptyBlankFrames: emptySameOrigin,
              brokenImages: brokenImages,
              hiddenCreatives: hiddenCreatives
            };
          }
        }
      }

      if (getDirectVisibleTextLength(container) >= 2) {
        var rRoot = container.getBoundingClientRect();
        if (rRoot.width >= 10 && rRoot.height >= 10) {
          return { visible: true, kind: 'text creative', width: rRoot.width, height: rRoot.height, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
        }
      }

      return { visible: false, kind: '', width: 0, height: 0, crossOriginFrames: crossOrigin, emptyBlankFrames: emptySameOrigin, brokenImages: brokenImages, hiddenCreatives: hiddenCreatives };
    }

    function collectNestedFrameDetails() {
      var list = [];
      for (var i = 0; i < nestedFrames.length; i++) {
        var fi = nestedFrames[i];
        var el = fi.el;
        var st = el && el.__imagelabBridgeState;
        var cs = null;
        var rect = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };
        try {
          if (el && el.getBoundingClientRect) rect = el.getBoundingClientRect();
          if (el) cs = window.getComputedStyle(el);
        } catch (e) {}

        var docAccess = 'cross_origin_blocked';
        var bridgeBodyChildCount = 0;
        var bridgeReadyState = '';
        if (st && !st.hasRemoteSrc) {
          docAccess = 'bridge_virtual';
          bridgeReadyState = st.readyState || '';
          try {
            if (st.shadowDoc && st.shadowDoc.body) bridgeBodyChildCount = st.shadowDoc.body.children.length;
            else if (st.virtualDoc && st.virtualDoc.body && st.virtualDoc.body.childNodes) bridgeBodyChildCount = st.virtualDoc.body.childNodes.length;
          } catch (be) {}
        } else if (el) {
          try {
            var nd = el.contentDocument || (el.contentWindow && el.contentWindow.document);
            if (nd && !nd.__isVirtualBridgeDoc) {
              docAccess = 'same_origin_native';
              bridgeReadyState = nd.readyState || '';
              bridgeBodyChildCount = nd.body ? nd.body.children.length : 0;
            }
          } catch (se) {}
        }

        var wroteHtmlBytes = st ? Math.max(st.rawBytesWritten || 0, (st.wroteBuffer || '').length) : 0;
        var effectiveReadyState = fi.nestedReadyState || bridgeReadyState || 'unknown';
        var effectiveBodyChildCount = fi.nestedHtmlLength ? (fi.nestedBodyChildCount || 0) : bridgeBodyChildCount;
        var effectivePeakBodyChildCount = Math.max(
          fi.nestedPeakBodyChildCount || 0,
          effectiveBodyChildCount,
          st ? (st.peakDomChildren || 0) : 0
        );
        var effectiveScriptCount = Math.max(fi.nestedScriptCount || 0, st && st.hadScriptTag ? 1 : 0);
        var effectiveImgCount = Math.max(fi.nestedImgCount || 0, st && st.hadImgTag ? 1 : 0);
        var effectiveChildIframeCount = Math.max(fi.nestedChildIframeCount || 0, st && st.hadChildIframeTag ? 1 : 0);
        var receivedHtml = Boolean(wroteHtmlBytes > 0 || (st && st.domAppendCount > 0) || fi.nestedBodyHtmlLength > 0 || effectiveBodyChildCount > 0 || effectiveScriptCount > 0 || effectiveImgCount > 0 || effectiveChildIframeCount > 0);
        var hasBodyContent = Boolean(fi.nestedBodyHtmlLength > 0 || effectiveBodyChildCount > 0 || effectiveImgCount > 0 || effectiveChildIframeCount > 0);
        var hiddenDetected = Boolean(fi.nestedHiddenCreative);
        var hiddenReason = fi.nestedHiddenCreative ? fi.nestedHiddenCreative.reason : '';
        if (!hiddenDetected && (hasBodyContent || fi.nestedVisible) && cs && (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') <= 0.02 || rect.width < 2 || rect.height < 2)) {
          hiddenDetected = true;
          hiddenReason = 'Nested iframe element is hidden or zero-sized (' + cs.display + '/' + cs.visibility + ', ' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ')';
        }
        var contentRemoved = Boolean(fi.nestedContentRemoved || (effectivePeakBodyChildCount > 0 && effectiveBodyChildCount === 0));
        var lifecycleSummary = fi.nestedVisible
          ? 'Visible creative detected (' + fi.nestedKind + ')'
          : hiddenDetected
            ? 'Creative inserted but hidden: ' + hiddenReason
            : contentRemoved
              ? 'Content inserted then removed (peakChildren=' + effectivePeakBodyChildCount + ', now=0)'
              : receivedHtml
                ? 'HTML/scripts received (writes=' + (st ? st.writeCallCount : 0) + ', bytes=' + wroteHtmlBytes + ', bodyChildren=' + effectiveBodyChildCount + ', scripts=' + effectiveScriptCount + ') without visible output'
                : 'Empty document (0 writes, 0 DOM appends, bodyChildren=0)';

        list.push({
          index: i + 1,
          src: fi.src || 'about:blank',
          documentAccess: docAccess,
          readyState: effectiveReadyState,
          receivedHtml: receivedHtml,
          hasBodyContent: hasBodyContent,
          wroteHtmlBytes: wroteHtmlBytes,
          writeCallCount: st ? st.writeCallCount : 0,
          flushCount: st ? st.flushCount : 0,
          srcdocBytes: st ? st.srcdocBytes : 0,
          bodyChildCount: effectiveBodyChildCount,
          peakBodyChildCount: effectivePeakBodyChildCount,
          scriptCount: effectiveScriptCount,
          imgCount: effectiveImgCount,
          childIframeCount: effectiveChildIframeCount,
          contentInsertedThenRemoved: contentRemoved,
          widthAttr: (el && (el.getAttribute('width') || (el.style && el.style.width))) || '',
          heightAttr: (el && (el.getAttribute('height') || (el.style && el.style.height))) || '',
          display: cs ? cs.display : 'unknown',
          visibility: cs ? cs.visibility : 'unknown',
          opacity: cs ? cs.opacity : '1',
          boundingRect: formatRectStr(rect) + ' (' + Math.round(rect.width || 0) + 'x' + Math.round(rect.height || 0) + ')',
          hiddenCreativeDetected: hiddenDetected,
          hiddenCreativeReason: hiddenReason,
          removedFromDom: Boolean(el && !el.isConnected),
          lifecycleSummary: lifecycleSummary
        });
      }
      return list;
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

    function countPendingFrames() {
      var pending = 0;
      var now = Date.now();
      for (var i = 0; i < nestedFrames.length; i++) {
        var f = nestedFrames[i];
        if (!f) continue;
        if (!f.loadFired && !f.errorFired) pending++;
        else if (f.nestedPendingAssets > 0) pending++;
        else if (f.lastFlushMs && (now - f.lastFlushMs) < 3500 && !f.nestedVisible && !f.nestedBlocked) pending++;
      }
      return pending;
    }

    function hasLoadedCrossOriginFrame() {
      for (var i = 0; i < nestedFrames.length; i++) {
        var f = nestedFrames[i];
        if (f && f.loadFired && !f.errorFired) {
          if (isExternalHttpUrl(f.src) || isExternalHttpUrl(f.nestedCrossOriginUrl)) return true;
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

    function clearGraceTimer() {
      if (graceSettleTimer) {
        clearTimeout(graceSettleTimer);
        graceSettleTimer = null;
      }
    }

    function scanUntrackedElements() {
      if (probeDisposed) return;
      var nodes = document.querySelectorAll('script[src], iframe, img');
      for (var i = 0; i < nodes.length; i++) {
        trackElement(nodes[i]);
      }
    }

    function determineFailureClassification(res, nestedDetails) {
      if (res.visible) return 'creative_rendered';
      if (sandboxErrors.length > 0 || blockedResources.length > 0) {
        return 'creative_blocked_by_sandbox';
      }
      if (res.hiddenCreatives && res.hiddenCreatives.length > 0) {
        return 'creative_inserted_but_hidden';
      }
      for (var i = 0; i < nestedDetails.length; i++) {
        if (nestedDetails[i].hiddenCreativeDetected) return 'creative_inserted_but_hidden';
      }
      if (ioState.observed && ioState.isIntersecting === false && ioState.boundingRect.indexOf('x0') !== -1) {
        return 'detection_monitoring_bug';
      }
      if (nestedDetails.length > 0) {
        for (var j = 0; j < nestedDetails.length; j++) {
          if (!nestedDetails[j].receivedHtml || nestedDetails[j].contentInsertedThenRemoved || nestedDetails[j].bodyChildCount === 0) {
            return 'empty_iframe_document';
          }
        }
      }
      return 'provider_no_fill';
    }

    window.__imagelabAdProbe = {
      scan: scanUntrackedElements,
      updateIntersection: function (entry) {
        if (!entry) return;
        ioState.observed = true;
        ioState.isIntersecting = Boolean(entry.isIntersecting);
        ioState.intersectionRatio = typeof entry.intersectionRatio === 'number' ? Math.round(entry.intersectionRatio * 1000) / 1000 : null;
        ioState.boundingRect = formatRectStr(entry.boundingClientRect);
        ioState.intersectionRect = formatRectStr(entry.intersectionRect);
      },
      report: function (isFinal) {
        if (probeDisposed || hasSettledFinal) return;
        scanUntrackedElements();
        var root = document.getElementById('ad-root');
        var inspectTarget = document.body || root;
        var res = inspectContainerDom(inspectTarget, document);
        var nestedDetails = collectNestedFrameDetails();
        var stats = countScriptStats();
        var pendingFrames = countPendingFrames();
        var elapsed = Date.now() - probeStartTime;

        var telemetrySnapshot = {
          nestedIframeDetails: nestedDetails,
          intersectionObserver: {
            supported: ioState.supported,
            observed: ioState.observed,
            isIntersecting: ioState.isIntersecting,
            intersectionRatio: ioState.intersectionRatio,
            boundingRect: ioState.boundingRect,
            intersectionRect: ioState.intersectionRect
          }
        };
        var telemetrySig = JSON.stringify(telemetrySnapshot);
        if (telemetrySig !== lastTelemetrySignature) {
          lastTelemetrySignature = telemetrySig;
          emitDiagnostic('frame_telemetry', lastEmittedStatus || 'loading', 'Updated nested iframe & IntersectionObserver telemetry', '', '', telemetrySnapshot);
        }

        var docHeight = Math.max(
          root && root.getBoundingClientRect ? Math.ceil(root.getBoundingClientRect().height || 0) : 0,
          document.body ? Number(document.body.scrollHeight || 0) : 0,
          document.documentElement ? Number(document.documentElement.scrollHeight || 0) : 0
        );

        // 1. Confirmed visible creative always wins
        if (res.visible) {
          clearCrossOriginTimer();
          clearGraceTimer();
          hasSettledFinal = true;
          var visMsg = 'Verified ' + res.kind + ' (' + Math.round(res.width) + '×' + Math.round(res.height) + 'px) rendered cleanly.';
          emitDiagnostic('creative_rendered', 'loaded', visMsg, '', '', {
            failureClassification: 'creative_rendered',
            nestedIframeDetails: nestedDetails,
            intersectionObserver: telemetrySnapshot.intersectionObserver
          });
          postStatus('loaded', docHeight, visMsg);
          return;
        }

        // 2. External script or nested frame was blocked / returned HTTP 403 / unreachable
        if (blockedResources.length > 0 && (stats.pending === 0 || isFinal)) {
          clearCrossOriginTimer();
          clearGraceTimer();
          hasSettledFinal = true;
          var firstBlock = blockedResources[0];
          var blockMsg = firstBlock.reason + (firstBlock.url ? ': ' + firstBlock.url.slice(0, 140) : '');
          emitDiagnostic('script_failed', 'script_blocked', blockMsg, firstBlock.url || '', '', {
            failureClassification: 'creative_blocked_by_sandbox',
            nestedIframeDetails: nestedDetails,
            intersectionObserver: telemetrySnapshot.intersectionObserver
          });
          postStatus('script_blocked', 0, blockMsg);
          return;
        }

        // 3. JavaScript runtime exception or broken image asset
        var brokenImgUrl = imageErrors[0] || (res.brokenImages && res.brokenImages[0]) || '';
        if ((runtimeErrors.length > 0 || brokenImgUrl) && (stats.pending === 0 || isFinal)) {
          clearCrossOriginTimer();
          clearGraceTimer();
          hasSettledFinal = true;
          var errMsg = runtimeErrors[0]
            ? 'Script runtime error: ' + runtimeErrors[0]
            : 'Creative image failed to load (' + String(brokenImgUrl).slice(0, 140) + ')';
          emitDiagnostic('script_failed', 'error', errMsg, brokenImgUrl || '', '', {
            failureClassification: determineFailureClassification(res, nestedDetails),
            nestedIframeDetails: nestedDetails,
            intersectionObserver: telemetrySnapshot.intersectionObserver
          });
          postStatus('error', 0, errMsg);
          return;
        }

        // 4. Do NOT prematurely settle/unmount while external script, nested srcdoc, or nested assets are pending (extend up to 18s)
        if (isFinal && (stats.pending > 0 || pendingFrames > 0) && elapsed < 17500) {
          if (!graceSettleTimer) {
            graceSettleTimer = setTimeout(function () {
              graceSettleTimer = null;
              if (window.__imagelabAdProbe) {
                window.__imagelabAdProbe.report(true);
              }
            }, Math.max(400, 18000 - elapsed));
          }
          if (pendingFrames > 0) {
            postStatus(
              'iframe_created',
              0,
              'Waiting for nested ad iframe to finish loading (' + Math.round(elapsed / 1000) + 's)...'
            );
          } else {
            postStatus(
              'script_request_started',
              0,
              'Waiting for external ad script response (' + Math.round(elapsed / 1000) + 's)...'
            );
          }
          return;
        }

        // 5. Intermediate progress signals: distinguish request started vs script loaded vs iframe created
        if (!isFinal) {
          if (res.crossOriginFrames.length > 0 && stats.pending === 0 && pendingFrames === 0 && hasLoadedCrossOriginFrame() && !crossOriginSettleTimer) {
            crossOriginSettleTimer = setTimeout(function () {
              crossOriginSettleTimer = null;
              if (window.__imagelabAdProbe) {
                window.__imagelabAdProbe.report(true);
              }
            }, 450);
          }

          if (res.emptyBlankFrames > 0 || nestedFrames.length > 0) {
            postStatus(
              'iframe_created',
              0,
              'External ad script mounted a nested iframe; waiting for creative content inside the frame...'
            );
            return;
          }

          if (stats.total > 0 && stats.loaded > 0 && stats.pending === 0) {
            postStatus(
              'script_loaded',
              0,
              'External ad script loaded (' + stats.loaded + '/' + stats.total + '); checking creative output...'
            );
            return;
          }

          if (stats.pending > 0) {
            postStatus(
              'script_request_started',
              0,
              'Requesting external ad script (' + stats.pending + ' pending)...'
            );
          }
          return;
        }

        // 6. Final settle evaluation (NEVER treat an empty about:blank iframe as visible creative!)
        if (isFinal) {
          clearCrossOriginTimer();
          clearGraceTimer();
          hasSettledFinal = true;
          if (isPopunder) {
            var popMsg = 'Popunder script loaded without errors (triggers on click/navigation rather than an inline banner).';
            emitDiagnostic('creative_rendered', 'popunder_ready', popMsg, '', '', {
              failureClassification: 'creative_rendered',
              nestedIframeDetails: nestedDetails,
              intersectionObserver: telemetrySnapshot.intersectionObserver
            });
            postStatus('popunder_ready', 0, popMsg);
            return;
          }

          if (res.crossOriginFrames.length > 0) {
            var frameHost = res.crossOriginFrames[0].host || providerName;
            var crossMsg =
              'External script loaded cleanly and mounted an isolated cross-origin frame (' +
              frameHost +
              '). Strict sandbox protection remains active; you can save and test this ad on the actual published website.';
            emitDiagnostic('creative_rendered', 'preview_unsupported', crossMsg, res.crossOriginFrames[0].src || '', '', {
              nestedIframeDetails: nestedDetails,
              intersectionObserver: telemetrySnapshot.intersectionObserver
            });
            postStatus('preview_unsupported', docHeight, crossMsg);
            return;
          }

          if (stats.pending > 0 || pendingFrames > 0) {
            var timeoutMsg =
              'Timed out after ' +
              Math.round(elapsed / 1000) +
              's waiting for ' +
              (stats.pending > 0 ? 'external script' : 'nested ad iframe') +
              ' response.';
            emitDiagnostic(
              'timeout',
              'timeout',
              timeoutMsg,
              externalScripts[0] ? externalScripts[0].url : '',
              '',
              {
                failureClassification: determineFailureClassification(res, nestedDetails),
                nestedIframeDetails: nestedDetails,
                intersectionObserver: telemetrySnapshot.intersectionObserver
              }
            );
            postStatus('timeout', 0, timeoutMsg);
            return;
          }

          var classification = determineFailureClassification(res, nestedDetails);

          if (classification === 'creative_inserted_but_hidden') {
            var hiddenReason = (res.hiddenCreatives[0] && res.hiddenCreatives[0].reason) ||
              (nestedDetails[0] && nestedDetails[0].hiddenCreativeReason) ||
              'Creative element inserted with display:none, visibility:hidden, opacity:0, or 0x0 bounds.';
            var hiddenMsg = 'Creative inserted but hidden: ' + hiddenReason;
            emitDiagnostic('browser_restriction', 'rendering_blocked', hiddenMsg, '', '', {
              failureClassification: 'creative_inserted_but_hidden',
              nestedIframeDetails: nestedDetails,
              intersectionObserver: telemetrySnapshot.intersectionObserver
            });
            postStatus('rendering_blocked', 0, hiddenMsg);
            return;
          }

          if (classification === 'creative_blocked_by_sandbox' || sandboxErrors.length > 0) {
            var restrictMsg =
              'Creative blocked by sandbox/CSP: ' +
              (sandboxErrors[0] || 'browser security restriction') +
              (res.emptyBlankFrames > 0 ? ' (mounted nested about:blank iframe stayed empty).' : '.');
            emitDiagnostic('browser_restriction', 'rendering_blocked', restrictMsg, '', '', {
              failureClassification: 'creative_blocked_by_sandbox',
              nestedIframeDetails: nestedDetails,
              intersectionObserver: telemetrySnapshot.intersectionObserver
            });
            postStatus('rendering_blocked', 0, restrictMsg);
            return;
          }

          var noFillMsg = classification === 'empty_iframe_document' && nestedDetails.length > 0
            ? providerName + ' script loaded and created nested about:blank iframe (' + nestedDetails[0].lifecycleSummary + ').'
            : res.emptyBlankFrames > 0
              ? providerName + ' script loaded and mounted an empty about:blank iframe, but returned no ad inventory or visible creative.'
              : stats.loaded > 0
                ? providerName + ' script loaded (' + stats.loaded + ' script' + (stats.loaded > 1 ? 's' : '') + ') with an empty/no-op response and created no creative.'
                : (atFormat === 'iframe'
                  ? providerName + ' snippet executed without errors, but no creative fill was returned.'
                  : 'Advertisement snippet executed without errors, but produced no visible creative output.');
          emitDiagnostic(
            'empty_response',
            'no_inventory',
            noFillMsg,
            externalScripts[0] ? externalScripts[0].url : '',
            '',
            {
              failureClassification: classification,
              nestedIframeDetails: nestedDetails,
              intersectionObserver: telemetrySnapshot.intersectionObserver
            }
          );
          postStatus('no_inventory', 0, noFillMsg);
        }
      },
      dispose: function () {
        probeDisposed = true;
        clearCrossOriginTimer();
        clearGraceTimer();
        if (headMutationObserver && headMutationObserver.disconnect) {
          try { headMutationObserver.disconnect(); } catch (e) {}
        }
        headMutationObserver = null;
      }
    };
  })();
</script>
</head>
<body>
  <div class="ad-root" id="ad-root">${wrappedCreative}</div>
  <script data-imagelab-probe="1">
    (function () {
      var root = document.getElementById('ad-root');
      var observeTarget = document.body || root;
      var bodyMutationObserver = null;
      var bodyResizeObserver = null;
      var bodyIntersectionObserver = null;
      var probeTimers = [];
      var run = function (isFinal) {
        if (window.__imagelabAdProbe) {
          window.__imagelabAdProbe.report(Boolean(isFinal));
        }
      };
      if (window.__imagelabAdProbe && window.__imagelabAdProbe.scan) {
        window.__imagelabAdProbe.scan();
      }
      if (typeof IntersectionObserver !== 'undefined' && root) {
        try {
          bodyIntersectionObserver = new IntersectionObserver(function (entries) {
            if (entries && entries.length > 0 && window.__imagelabAdProbe && window.__imagelabAdProbe.updateIntersection) {
              window.__imagelabAdProbe.updateIntersection(entries[entries.length - 1]);
              run(false);
            }
          }, { threshold: [0, 0.1, 0.5, 1] });
          bodyIntersectionObserver.observe(root);
        } catch (ioErr) {}
      }
      if (document.readyState === 'complete') {
        run(false);
      } else {
        window.addEventListener('load', function () { run(false); });
      }
      probeTimers.push(setTimeout(function () { run(false); }, 150));
      probeTimers.push(setTimeout(function () { run(false); }, 650));
      probeTimers.push(setTimeout(function () { run(false); }, 1500));
      probeTimers.push(setTimeout(function () { run(false); }, 3000));
      probeTimers.push(setTimeout(function () { run(false); }, 5500));
      probeTimers.push(setTimeout(function () { run(false); }, 8000));
      probeTimers.push(setTimeout(function () { run(false); }, 11000));
      probeTimers.push(setTimeout(function () { run(true); }, 14000));
      if (typeof MutationObserver !== 'undefined' && observeTarget) {
        bodyMutationObserver = new MutationObserver(function () { run(false); });
        bodyMutationObserver.observe(observeTarget, { childList: true, subtree: true, attributes: true });
      }
      if (typeof ResizeObserver !== 'undefined' && observeTarget) {
        bodyResizeObserver = new ResizeObserver(function () { run(false); });
        bodyResizeObserver.observe(observeTarget);
      }
      var disposeAll = function () {
        for (var t = 0; t < probeTimers.length; t++) clearTimeout(probeTimers[t]);
        probeTimers = [];
        if (bodyMutationObserver && bodyMutationObserver.disconnect) bodyMutationObserver.disconnect();
        if (bodyResizeObserver && bodyResizeObserver.disconnect) bodyResizeObserver.disconnect();
        if (bodyIntersectionObserver && bodyIntersectionObserver.disconnect) bodyIntersectionObserver.disconnect();
        if (window.__imagelabAdProbe && window.__imagelabAdProbe.dispose) {
          window.__imagelabAdProbe.dispose();
        }
      };
      window.addEventListener('pagehide', disposeAll);
      window.addEventListener('unload', disposeAll);
    })();
  </script>
</body>
</html>`;
}
