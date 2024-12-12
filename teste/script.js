(function () {
  'use strict';

  const Set$1 = globalThis.Set;
  const Reflect$1 = globalThis.Reflect;
  globalThis.customElements?.get.bind(globalThis.customElements);
  globalThis.customElements?.define.bind(globalThis.customElements);
  const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
  const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
  const objectKeys = Object.keys;
  const objectEntries = Object.entries;
  const Proxy$1 = globalThis.Proxy;
  const functionToString = Function.prototype.toString;

  /* global cloneInto, exportFunction, true */

  // Only use globalThis for testing this breaks window.wrappedJSObject code in Firefox
  // eslint-disable-next-line no-global-assign
  let globalObj$1 = typeof window === 'undefined' ? globalThis : window;
  let Error$1 = globalObj$1.Error;
  let messageSecret$1;

  const taintSymbol = Symbol('taint');

  // save a reference to original CustomEvent amd dispatchEvent so they can't be overriden to forge messages
  const OriginalCustomEvent = typeof CustomEvent === 'undefined' ? null : CustomEvent;
  const originalWindowDispatchEvent = typeof window === 'undefined' ? null : window.dispatchEvent.bind(window);
  function registerMessageSecret(secret) {
    messageSecret$1 = secret;
  }

  /**
   * @returns {HTMLElement} the element to inject the script into
   */
  function getInjectionElement() {
    return document.head || document.documentElement
  }

  /**
   * Creates a script element with the given code to avoid Firefox CSP restrictions.
   * @param {string} css
   * @returns {HTMLLinkElement | HTMLStyleElement}
   */
  function createStyleElement(css) {
    let style;
    {
      style = document.createElement('link');
      style.href = 'data:text/css,' + encodeURIComponent(css);
      style.setAttribute('rel', 'stylesheet');
      style.setAttribute('type', 'text/css');
    }
    return style
  }

  /**
   * Injects a script into the page, avoiding CSP restrictions if possible.
   */
  function injectGlobalStyles(css) {
    const style = createStyleElement(css);
    getInjectionElement().appendChild(style);
  }

  // linear feedback shift register to find a random approximation
  function nextRandom(v) {
    return Math.abs((v >> 1) | (((v << 62) ^ (v << 61)) & (~(~0 << 63) << 62)))
  }

  const exemptionLists = {};
  function shouldExemptUrl(type, url) {
    for (const regex of exemptionLists[type]) {
      if (regex.test(url)) {
        return true
      }
    }
    return false
  }

  let debug = false;

  function initStringExemptionLists(args) {
    const { stringExemptionLists } = args;
    debug = args.debug;
    for (const type in stringExemptionLists) {
      exemptionLists[type] = [];
      for (const stringExemption of stringExemptionLists[type]) {
        exemptionLists[type].push(new RegExp(stringExemption));
      }
    }
  }

  /**
   * Best guess effort if the document is being framed
   * @returns {boolean} if we infer the document is framed
   */
  function isBeingFramed() {
    if (globalThis.location && 'ancestorOrigins' in globalThis.location) {
      return globalThis.location.ancestorOrigins.length > 0
    }
    return globalThis.top !== globalThis.window
  }

  /**
   * Best guess effort if the document is third party
   * @returns {boolean} if we infer the document is third party
   */
  function isThirdPartyFrame() {
    if (!isBeingFramed()) {
      return false
    }
    const tabHostname = getTabHostname();
    // If we can't get the tab hostname, assume it's third party
    if (!tabHostname) {
      return true
    }
    return !matchHostname(globalThis.location.hostname, tabHostname)
  }

  /**
   * Best guess effort of the tabs hostname; where possible always prefer the args.site.domain
   * @returns {string|null} inferred tab hostname
   */
  function getTabHostname() {
    let framingOrigin = null;
    try {
      // @ts-expect-error - globalThis.top is possibly 'null' here
      framingOrigin = globalThis.top.location.href;
    } catch {
      framingOrigin = globalThis.document.referrer;
    }

    // Not supported in Firefox
    if ('ancestorOrigins' in globalThis.location && globalThis.location.ancestorOrigins.length) {
      // ancestorOrigins is reverse order, with the last item being the top frame
      framingOrigin = globalThis.location.ancestorOrigins.item(globalThis.location.ancestorOrigins.length - 1);
    }

    try {
      // @ts-expect-error - framingOrigin is possibly 'null' here
      framingOrigin = new URL(framingOrigin).hostname;
    } catch {
      framingOrigin = null;
    }
    return framingOrigin
  }

  /**
   * Returns true if hostname is a subset of exceptionDomain or an exact match.
   * @param {string} hostname
   * @param {string} exceptionDomain
   * @returns {boolean}
   */
  function matchHostname(hostname, exceptionDomain) {
    return hostname === exceptionDomain || hostname.endsWith(.${ exceptionDomain })
  }

  const lineTest = /(\()?(https?:[^)]+):[0-9]+:[0-9]+(\))?/;
  function getStackTraceUrls(stack) {
    const urls = new Set$1();
    try {
      const errorLines = stack.split('\n');
      // Should cater for Chrome and Firefox stacks, we only care about https? resources.
      for (const line of errorLines) {
        const res = line.match(lineTest);
        if (res) {
          urls.add(new URL(res[2], location.href));
        }
      }
    } catch (e) {
      // Fall through
    }
    return urls
  }

  function getStackTraceOrigins(stack) {
    const urls = getStackTraceUrls(stack);
    const origins = new Set$1();
    for (const url of urls) {
      origins.add(url.hostname);
    }
    return origins
  }

  // Checks the stack trace if there are known libraries that are broken.
  function shouldExemptMethod(type) {
    // Short circuit stack tracing if we don't have checks
    if (!(type in exemptionLists) || exemptionLists[type].length === 0) {
      return false
    }
    const stack = getStack();
    const errorFiles = getStackTraceUrls(stack);
    for (const path of errorFiles) {
      if (shouldExemptUrl(type, path.href)) {
        return true
      }
    }
    return false
  }

  // Iterate through the key, passing an item index and a byte to be modified
  function iterateDataKey(key, callback) {
    let item = key.charCodeAt(0);
    for (const i in key) {
      let byte = key.charCodeAt(i);
      for (let j = 8; j >= 0; j--) {
        const res = callback(item, byte);
        // Exit early if callback returns null
        if (res === null) {
          return
        }

        // find next item to perturb
        item = nextRandom(item);

        // Right shift as we use the least significant bit of it
        byte = byte >> 1;
      }
    }
  }

  function isFeatureBroken(args, feature) {
    return isWindowsSpecificFeature(feature)
      ? !args.site.enabledFeatures.includes(feature)
      : args.site.isBroken || args.site.allowlisted || !args.site.enabledFeatures.includes(feature)
  }

  function camelcase(dashCaseText) {
    return dashCaseText.replace(/-(.)/g, (match, letter) => {
      return letter.toUpperCase()
    })
  }

  // We use this method to detect M1 macs and set appropriate API values to prevent sites from detecting fingerprinting protections
  function isAppleSilicon() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl');

    // Best guess if the device is an Apple Silicon
    // https://stackoverflow.com/a/65412357
    // @ts-expect-error - Object is possibly 'null'
    return gl.getSupportedExtensions().indexOf('WEBGL_compressed_texture_etc') !== -1
  }

  /**
   * Take configSeting which should be an array of possible values.
   * If a value contains a criteria that is a match for this environment then return that value.
   * Otherwise return the first value that doesn't have a criteria.
   *
   * @param {*[]} configSetting - Config setting which should contain a list of possible values
   * @returns {*|undefined} - The value from the list that best matches the criteria in the config
   */
  function processAttrByCriteria(configSetting) {
    let bestOption;
    for (const item of configSetting) {
      if (item.criteria) {
        if (item.criteria.arch === 'AppleSilicon' && isAppleSilicon()) {
          bestOption = item;
          break
        }
      } else {
        bestOption = item;
      }
    }

    return bestOption
  }

  const functionMap = {
    /** Useful for debugging APIs in the wild, shouldn't be used */
    debug: (...args) => {
      console.log('debugger', ...args);
      // eslint-disable-next-line no-debugger
      debugger
    },
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    noop: () => { }
  };

  /**
   * Processes a structured config setting and returns the value according to its type
   * @param {*} configSetting
   * @param {*} [defaultValue]
   * @returns
   */
  function processAttr(configSetting, defaultValue) {
    if (configSetting === undefined) {
      return defaultValue
    }

    const configSettingType = typeof configSetting;
    switch (configSettingType) {
      case 'object':
        if (Array.isArray(configSetting)) {
          configSetting = processAttrByCriteria(configSetting);
          if (configSetting === undefined) {
            return defaultValue
          }
        }

        if (!configSetting.type) {
          return defaultValue
        }

        if (configSetting.type === 'function') {
          if (configSetting.functionName && functionMap[configSetting.functionName]) {
            return functionMap[configSetting.functionName]
          }
        }

        if (configSetting.type === 'undefined') {
          return undefined
        }

        return configSetting.value
      default:
        return defaultValue
    }
  }

  function getStack() {
    return new Error$1().stack
  }

  function getContextId(scope) {
    if (document?.currentScript && 'contextID' in document.currentScript) {
      return document.currentScript.contextID
    }
    if (scope.contextID) {
      return scope.contextID
    }
    // @ts-expect-error - contextID is a global variable
    if (typeof contextID !== 'undefined') {
      // @ts-expect-error - contextID is a global variable
      // eslint-disable-next-line no-undef
      return contextID
    }
  }

  /**
   * Returns a set of origins that are tainted
   * @returns {Set<string> | null}
   */
  function taintedOrigins() {
    return getGlobalObject('taintedOrigins')
  }

  /**
   * @param {string} name
   * @returns {any | null}
   */
  function getGlobalObject(name) {
    if ('duckduckgo' in navigator &&
      typeof navigator.duckduckgo === 'object' &&
      navigator.duckduckgo &&
      name in navigator.duckduckgo &&
      navigator.duckduckgo[name]) {
      return navigator.duckduckgo[name]
    }
    return null
  }

  function hasTaintedMethod(scope, shouldStackCheck = false) {
    if (document?.currentScript?.[taintSymbol]) return true
    if ('_ddg_taint_' in window) return true
    if (getContextId(scope)) return true
    if (!shouldStackCheck || !taintedOrigins()) {
      return false
    }
    const currentTaintedOrigins = taintedOrigins();
    if (!currentTaintedOrigins || currentTaintedOrigins.size === 0) {
      return false
    }
    const stackOrigins = getStackTraceOrigins(getStack());
    for (const stackOrigin of stackOrigins) {
      if (currentTaintedOrigins.has(stackOrigin)) {
        return true
      }
    }
    return false
  }

  /**
   * @param {*[]} argsArray
   * @returns {string}
   */
  function debugSerialize(argsArray) {
    const maxSerializedSize = 1000;
    const serializedArgs = argsArray.map((arg) => {
      try {
        const serializableOut = JSON.stringify(arg);
        if (serializableOut.length > maxSerializedSize) {
          return <truncated, length: ${ serializableOut.length }, value: ${ serializableOut.substring(0, maxSerializedSize) }...>
              }
  return serializableOut
} catch (e) {
  // Sometimes this happens when we can't serialize an object to string but we still wish to log it and make other args readable
  return '<unserializable>'
}
      });
return JSON.stringify(serializedArgs)
  }

/**
 * @template {object} P
 * @typedef {object} ProxyObject<P>
 * @property {(target?: object, thisArg?: P, args?: object) => void} apply
 */

/**
 * @template [P=object]
 */
class DDGProxy {
  /**
   * @param {import('./content-feature').default} feature
   * @param {P} objectScope
   * @param {string} property
   * @param {ProxyObject<P>} proxyObject
   */
  constructor(feature, objectScope, property, proxyObject, taintCheck = false) {
    this.objectScope = objectScope;
    this.property = property;
    this.feature = feature;
    this.featureName = feature.name;
    this.camelFeatureName = camelcase(this.featureName);
    const outputHandler = (...args) => {
      this.feature.addDebugFlag();
      let isExempt = shouldExemptMethod(this.camelFeatureName);
      // If taint checking is enabled for this proxy then we should verify that the method is not tainted and exempt if it isn't
      if (!isExempt && taintCheck) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        let scope = this;
        try {
          // @ts-expect-error - Caller doesn't match this
          // eslint-disable-next-line no-caller
          scope = arguments.callee.caller;
        } catch { }
        const isTainted = hasTaintedMethod(scope);
        isExempt = !isTainted;
      }
      // Keep this here as getStack() is expensive
      if (debug) {
        postDebugMessage(this.camelFeatureName, {
          isProxy: true,
          action: isExempt ? 'ignore' : 'restrict',
          kind: this.property,
          documentUrl: document.location.href,
          stack: getStack(),
          args: debugSerialize(args[2])
        });
      }
      // The normal return value
      if (isExempt) {
        return DDGReflect.apply(...args)
      }
      return proxyObject.apply(...args)
    };
    const getMethod = (target, prop, receiver) => {
      this.feature.addDebugFlag();
      if (prop === 'toString') {
        const method = Reflect.get(target, prop, receiver).bind(target);
        Object.defineProperty(method, 'toString', {
          value: String.toString.bind(String.toString),
          enumerable: false
        });
        return method
      }
      return DDGReflect.get(target, prop, receiver)
    };
    {
      this._native = objectScope[property];
      const handler = new globalObj$1.wrappedJSObject.Object();
      handler.apply = exportFunction(outputHandler, globalObj$1);
      handler.get = exportFunction(getMethod, globalObj$1);
      // @ts-expect-error wrappedJSObject is not a property of objectScope
      this.internal = new globalObj$1.wrappedJSObject.Proxy(objectScope.wrappedJSObject[property], handler);
    }
  }

  // Actually apply the proxy to the native property
  overload() {
    {
      // @ts-expect-error wrappedJSObject is not a property of objectScope
      exportFunction(this.internal, this.objectScope, { defineAs: this.property });
    }
  }

  overloadDescriptor() {
    // TODO: this is not always correct! Use wrap* or shim* methods instead
    this.feature.defineProperty(this.objectScope, this.property, {
      value: this.internal,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
}

const maxCounter = new Map();
function numberOfTimesDebugged(feature) {
  if (!maxCounter.has(feature)) {
    maxCounter.set(feature, 1);
  } else {
    maxCounter.set(feature, maxCounter.get(feature) + 1);
  }
  return maxCounter.get(feature)
}

const DEBUG_MAX_TIMES = 5000;

function postDebugMessage(feature, message, allowNonDebug = false) {
  if (!debug && !allowNonDebug) {
    return
  }
  if (numberOfTimesDebugged(feature) > DEBUG_MAX_TIMES) {
    return
  }
  if (message.stack) {
    const scriptOrigins = [...getStackTraceOrigins(message.stack)];
    message.scriptOrigins = scriptOrigins;
  }
  globalObj$1.postMessage({
    action: feature,
    message
  });
}

let DDGReflect;
let DDGPromise;

// Exports for usage where we have to cross the xray boundary: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
{
  DDGPromise = globalObj$1.wrappedJSObject.Promise;
  DDGReflect = globalObj$1.wrappedJSObject.Reflect;
}

/**
 * @param {string | null} topLevelHostname
 * @param {object[]} featureList
 * @returns {boolean}
 */
function isUnprotectedDomain(topLevelHostname, featureList) {
  let unprotectedDomain = false;
  if (!topLevelHostname) {
    return false
  }
  const domainParts = topLevelHostname.split('.');

  // walk up the domain to see if it's unprotected
  while (domainParts.length > 1 && !unprotectedDomain) {
    const partialDomain = domainParts.join('.');

    unprotectedDomain = featureList.filter(domain => domain.domain === partialDomain).length > 0;

    domainParts.shift();
  }

  return unprotectedDomain
}

/**
 * @typedef {object} Platform
 * @property {'ios' | 'macos' | 'extension' | 'android' | 'windows'} name
 * @property {string | number } [version]
 */

/**
 * @typedef {object} UserPreferences
 * @property {Platform} platform
 * @property {boolean} [debug]
 * @property {boolean} [globalPrivacyControl]
 * @property {number} [versionNumber] - Android version number only
 * @property {string} [versionString] - Non Android version string
 * @property {string} sessionKey
 */

/**
 * Used to inialize extension code in the load phase
 */
function computeLimitedSiteObject() {
  const topLevelHostname = getTabHostname();
  return {
    domain: topLevelHostname
  }
}

function parseVersionString(versionString) {
  return versionString.split('.').map(Number)
}

/**
 * @param {string} minVersionString
 * @param {string} applicationVersionString
 * @returns {boolean}
 */
function satisfiesMinVersion(minVersionString, applicationVersionString) {
  const minVersions = parseVersionString(minVersionString);
  const currentVersions = parseVersionString(applicationVersionString);
  const maxLength = Math.max(minVersions.length, currentVersions.length);
  for (let i = 0; i < maxLength; i++) {
    const minNumberPart = minVersions[i] || 0;
    const currentVersionPart = currentVersions[i] || 0;
    if (currentVersionPart > minNumberPart) {
      return true
    }
    if (currentVersionPart < minNumberPart) {
      return false
    }
  }
  return true
}

/**
 * @param {string | number | undefined} minSupportedVersion
 * @param {string | number | undefined} currentVersion
 * @returns {boolean}
 */
function isSupportedVersion(minSupportedVersion, currentVersion) {
  if (typeof currentVersion === 'string' && typeof minSupportedVersion === 'string') {
    if (satisfiesMinVersion(minSupportedVersion, currentVersion)) {
      return true
    }
  } else if (typeof currentVersion === 'number' && typeof minSupportedVersion === 'number') {
    if (minSupportedVersion <= currentVersion) {
      return true
    }
  }
  return false
}

/**
 * Retutns a list of enabled features
 * @param {RemoteConfig} data
 * @param {string | null} topLevelHostname
 * @param {Platform['version']} platformVersion
 * @param {string[]} platformSpecificFeatures
 * @returns {string[]}
 */
function computeEnabledFeatures(data, topLevelHostname, platformVersion, platformSpecificFeatures = []) {
  const remoteFeatureNames = Object.keys(data.features);
  const platformSpecificFeaturesNotInRemoteConfig = platformSpecificFeatures.filter((featureName) => !remoteFeatureNames.includes(featureName));
  const enabledFeatures = remoteFeatureNames.filter((featureName) => {
    const feature = data.features[featureName];
    // Check that the platform supports minSupportedVersion checks and that the feature has a minSupportedVersion
    if (feature.minSupportedVersion && platformVersion) {
      if (!isSupportedVersion(feature.minSupportedVersion, platformVersion)) {
        return false
      }
    }
    return feature.state === 'enabled' && !isUnprotectedDomain(topLevelHostname, feature.exceptions)
  }).concat(platformSpecificFeaturesNotInRemoteConfig); // only disable platform specific features if it's explicitly disabled in remote config
  return enabledFeatures
}

/**
 * Returns the relevant feature settings for the enabled features
 * @param {RemoteConfig} data
 * @param {string[]} enabledFeatures
 * @returns {Record<string, unknown>}
 */
function parseFeatureSettings(data, enabledFeatures) {
  /** @type {Record<string, unknown>} */
  const featureSettings = {};
  const remoteFeatureNames = Object.keys(data.features);
  remoteFeatureNames.forEach((featureName) => {
    if (!enabledFeatures.includes(featureName)) {
      return
    }

    featureSettings[featureName] = data.features[featureName].settings;
  });
  return featureSettings
}

const windowsSpecificFeatures = ['windowsPermissionUsage'];

function isWindowsSpecificFeature(featureName) {
  return windowsSpecificFeatures.includes(featureName)
}

function createCustomEvent(eventName, eventDetail) {
  // By default, Firefox protects the event detail Object from the page,
  // leading to "Permission denied to access property" errors.
  // See https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts
  {
    eventDetail = cloneInto(eventDetail, window);
  }

  // @ts-expect-error - possibly null
  return new OriginalCustomEvent(eventName, eventDetail)
}

/** @deprecated */
function legacySendMessage(messageType, options) {
  // FF & Chrome
  return originalWindowDispatchEvent && originalWindowDispatchEvent(createCustomEvent('sendMessageProxy' + messageSecret$1, { detail: { messageType, options } }))
  // TBD other platforms
}

const baseFeatures = /** @type {const} */([
  'runtimeChecks',
  'fingerprintingAudio',
  'fingerprintingBattery',
  'fingerprintingCanvas',
  'googleRejected',
  'gpc',
  'fingerprintingHardware',
  'referrer',
  'fingerprintingScreenSize',
  'fingerprintingTemporaryStorage',
  'navigatorInterface',
  'elementHiding',
  'exceptionHandler'
]);

const otherFeatures = /** @type {const} */([
  'clickToLoad',
  'cookie',
  'duckPlayer',
  'harmfulApis',
  'webCompat',
  'windowsPermissionUsage',
  'brokerProtection',
  'performanceMetrics'
]);

/** @typedef {baseFeatures[number]|otherFeatures[number]} FeatureName */
/** @type {Record<string, FeatureName[]>} */
const platformSupport = {
  apple: [
    'webCompat',
    ...baseFeatures
  ],
  'apple-isolated': [
    'duckPlayer',
    'brokerProtection',
    'performanceMetrics',
    'clickToLoad'
  ],
  android: [
    ...baseFeatures,
    'webCompat',
    'clickToLoad'
  ],
  windows: [
    'cookie',
    ...baseFeatures,
    'windowsPermissionUsage',
    'duckPlayer',
    'brokerProtection'
  ],
  firefox: [
    'cookie',
    ...baseFeatures,
    'clickToLoad'
  ],
  chrome: [
    'cookie',
    ...baseFeatures,
    'clickToLoad'
  ],
  'chrome-mv3': [
    'cookie',
    ...baseFeatures,
    'clickToLoad'
  ],
  integration: [
    ...baseFeatures,
    ...otherFeatures
  ]
};

/**
 * Performance monitor, holds reference to PerformanceMark instances.
 */
class PerformanceMonitor {
  constructor() {
    this.marks = [];
  }

  /**
   * Create performance marker
   * @param {string} name
   * @returns {PerformanceMark}
   */
  mark(name) {
    const mark = new PerformanceMark(name);
    this.marks.push(mark);
    return mark
  }

  /**
   * Measure all performance markers
   */
  measureAll() {
    this.marks.forEach((mark) => {
      mark.measure();
    });
  }
}

/**
 * Tiny wrapper around performance.mark and performance.measure
 */
class PerformanceMark {
  /**
   * @param {string} name
   */
  constructor(name) {
    this.name = name;
    performance.mark(this.name + 'Start');
  }

  end() {
    performance.mark(this.name + 'End');
  }

  measure() {
    performance.measure(this.name, this.name + 'Start', this.name + 'End');
  }
}

var injectedFeaturesCode = {
  "runtimeChecks": "/! © DuckDuckGo ContentScopeScripts protections https://github.com/duckduckgo/content-scope-scripts/ */\nvar runtimeChecks = (function () {\n    'use strict';\n\n    const Set$1 = globalThis.Set;\n    const Reflect$1 = globalThis.Reflect;\n    globalThis.customElements?.get.bind(globalThis.customElements);\n    globalThis.customElements?.define.bind(globalThis.customElements);\n    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;\n    const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;\n    const objectKeys = Object.keys;\n    const objectEntries = Object.entries;\n    const objectDefineProperty = Object.defineProperty;\n    const Proxy$1 = globalThis.Proxy;\n    const functionToString = Function.prototype.toString;\n\n    / global cloneInto, exportFunction, false /\n\n    // Only use globalThis for testing this breaks window.wrappedJSObject code in Firefox\n    // eslint-disable-next-line no-global-assign\n    let globalObj = typeof window === 'undefined' ? globalThis : window;\n    let Error$1 = globalObj.Error;\n    let messageSecret;\n\n    const taintSymbol = Symbol('taint');\n\n    // save a reference to original CustomEvent amd dispatchEvent so they can't be overriden to forge messages\n    const OriginalCustomEvent = typeof CustomEvent === 'undefined' ? null : CustomEvent;\n    const originalWindowDispatchEvent = typeof window === 'undefined' ? null : window.dispatchEvent.bind(window);\n\n    /\n     * @returns {HTMLElement} the element to inject the script into\n     */\n    function getInjectionElement () {\n        return document.head || document.documentElement\n    }\n\n    /\n     * Creates a script element with the given code to avoid Firefox CSP restrictions.\n     * @param {string} css\n     * @returns {HTMLLinkElement | HTMLStyleElement}\n     */\n    function createStyleElement (css) {\n        let style;\n        {\n            style = document.createElement('style');\n            style.innerText = css;\n        }\n        return style\n    }\n\n    /\n     * Injects a script into the page, avoiding CSP restrictions if possible.\n     */\n    function injectGlobalStyles (css) {\n        const style = createStyleElement(css);\n        getInjectionElement().appendChild(style);\n    }\n\n    const exemptionLists = {};\n    function shouldExemptUrl (type, url) {\n        for (const regex of exemptionLists[type]) {\n            if (regex.test(url)) {\n                return true\n            }\n        }\n        return false\n    }\n\n    /\n     * Best guess effort if the document is being framed\n     * @returns {boolean} if we infer the document is framed\n     */\n    function isBeingFramed () {\n        if (globalThis.location && 'ancestorOrigins' in globalThis.location) {\n            return globalThis.location.ancestorOrigins.length > 0\n        }\n        return globalThis.top !== globalThis.window\n    }\n\n    /\n     * Best guess effort of the tabs hostname; where possible always prefer the args.site.domain\n     * @returns {string|null} inferred tab hostname\n     */\n    function getTabHostname () {\n        let framingOrigin = null;\n        try {\n            // @ts-expect-error - globalThis.top is possibly 'null' here\n            framingOrigin = globalThis.top.location.href;\n        } catch {\n            framingOrigin = globalThis.document.referrer;\n        }\n\n        // Not supported in Firefox\n        if ('ancestorOrigins' in globalThis.location && globalThis.location.ancestorOrigins.length) {\n            // ancestorOrigins is reverse order, with the last item being the top frame\n            framingOrigin = globalThis.location.ancestorOrigins.item(globalThis.location.ancestorOrigins.length - 1);\n        }\n\n        try {\n            // @ts-expect-error - framingOrigin is possibly 'null' here\n            framingOrigin = new URL(framingOrigin).hostname;\n        } catch {\n            framingOrigin = null;\n        }\n        return framingOrigin\n    }\n\n    /\n     * Returns true if hostname is a subset of exceptionDomain or an exact match.\n     * @param {string} hostname\n     * @param {string} exceptionDomain\n     * @returns {boolean}\n     */\n    function matchHostname (hostname, exceptionDomain) {\n        return hostname === exceptionDomain || hostname.endsWith(.${exceptionDomain})\n    }\n\n    const lineTest = /(\\()?(https?:[^)]+):[0-9]+:[0-9]+(\\))?/;\n    function getStackTraceUrls (stack) {\n        const urls = new Set$1();\n        try {\n            const errorLines = stack.split('\\n');\n            // Should cater for Chrome and Firefox stacks, we only care about https? resources.\n            for (const line of errorLines) {\n                const res = line.match(lineTest);\n                if (res) {\n                    urls.add(new URL(res[2], location.href));\n                }\n            }\n        } catch (e) {\n            // Fall through\n        }\n        return urls\n    }\n\n    function getStackTraceOrigins (stack) {\n        const urls = getStackTraceUrls(stack);\n        const origins = new Set$1();\n        for (const url of urls) {\n            origins.add(url.hostname);\n        }\n        return origins\n    }\n\n    // Checks the stack trace if there are known libraries that are broken.\n    function shouldExemptMethod (type) {\n        // Short circuit stack tracing if we don't have checks\n        if (!(type in exemptionLists) || exemptionLists[type].length === 0) {\n            return false\n        }\n        const stack = getStack();\n        const errorFiles = getStackTraceUrls(stack);\n        for (const path of errorFiles) {\n            if (shouldExemptUrl(type, path.href)) {\n                return true\n            }\n        }\n        return false\n    }\n\n    function camelcase (dashCaseText) {\n        return dashCaseText.replace(/-(.)/g, (match, letter) => {\n            return letter.toUpperCase()\n        })\n    }\n\n    // We use this method to detect M1 macs and set appropriate API values to prevent sites from detecting fingerprinting protections\n    function isAppleSilicon () {\n        const canvas = document.createElement('canvas');\n        const gl = canvas.getContext('webgl');\n\n        // Best guess if the device is an Apple Silicon\n        // https://stackoverflow.com/a/65412357\n        // @ts-expect-error - Object is possibly 'null'\n        return gl.getSupportedExtensions().indexOf('WEBGL_compressed_texture_etc') !== -1\n    }\n\n    /\n     * Take configSeting which should be an array of possible values.\n     * If a value contains a criteria that is a match for this environment then return that value.\n     * Otherwise return the first value that doesn't have a criteria.\n     *\n     * @param {[]} configSetting - Config setting which should contain a list of possible values\n     * @returns {|undefined} - The value from the list that best matches the criteria in the config\n     */\n    function processAttrByCriteria (configSetting) {\n        let bestOption;\n        for (const item of configSetting) {\n            if (item.criteria) {\n                if (item.criteria.arch === 'AppleSilicon' && isAppleSilicon()) {\n                    bestOption = item;\n                    break\n                }\n            } else {\n                bestOption = item;\n            }\n        }\n\n        return bestOption\n    }\n\n    const functionMap = {\n        /* Useful for debugging APIs in the wild, shouldn't be used /\n        debug: (...args) => {\n            console.log('debugger', ...args);\n            // eslint-disable-next-line no-debugger\n            debugger\n        },\n        // eslint-disable-next-line @typescript-eslint/no-empty-function\n        noop: () => { }\n    };\n\n    /\n     * Processes a structured config setting and returns the value according to its type\n     * @param {} configSetting\n     * @param {} [defaultValue]\n     * @returns\n     */\n    function processAttr (configSetting, defaultValue) {\n        if (configSetting === undefined) {\n            return defaultValue\n        }\n\n        const configSettingType = typeof configSetting;\n        switch (configSettingType) {\n        case 'object':\n            if (Array.isArray(configSetting)) {\n                configSetting = processAttrByCriteria(configSetting);\n                if (configSetting === undefined) {\n                    return defaultValue\n                }\n            }\n\n            if (!configSetting.type) {\n                return defaultValue\n            }\n\n            if (configSetting.type === 'function') {\n                if (configSetting.functionName && functionMap[configSetting.functionName]) {\n                    return functionMap[configSetting.functionName]\n                }\n            }\n\n            if (configSetting.type === 'undefined') {\n                return undefined\n            }\n\n            return configSetting.value\n        default:\n            return defaultValue\n        }\n    }\n\n    function getStack () {\n        return new Error$1().stack\n    }\n\n    function getContextId (scope) {\n        if (document?.currentScript && 'contextID' in document.currentScript) {\n            return document.currentScript.contextID\n        }\n        if (scope.contextID) {\n            return scope.contextID\n        }\n        // @ts-expect-error - contextID is a global variable\n        if (typeof contextID !== 'undefined') {\n            // @ts-expect-error - contextID is a global variable\n            // eslint-disable-next-line no-undef\n            return contextID\n        }\n    }\n\n    /\n     * Returns a set of origins that are tainted\n     * @returns {Set<string> | null}\n     */\n    function taintedOrigins () {\n        return getGlobalObject('taintedOrigins')\n    }\n\n    /\n     * @param {string} name\n     * @returns {any | null}\n     */\n    function getGlobalObject (name) {\n        if ('duckduckgo' in navigator &&\n            typeof navigator.duckduckgo === 'object' &&\n            navigator.duckduckgo &&\n            name in navigator.duckduckgo &&\n            navigator.duckduckgo[name]) {\n            return navigator.duckduckgo[name]\n        }\n        return null\n    }\n\n    function hasTaintedMethod (scope, shouldStackCheck = false) {\n        if (document?.currentScript?.[taintSymbol]) return true\n        if ('_ddg_taint_' in window) return true\n        if (getContextId(scope)) return true\n        if (!shouldStackCheck || !taintedOrigins()) {\n            return false\n        }\n        const currentTaintedOrigins = taintedOrigins();\n        if (!currentTaintedOrigins || currentTaintedOrigins.size === 0) {\n            return false\n        }\n        const stackOrigins = getStackTraceOrigins(getStack());\n        for (const stackOrigin of stackOrigins) {\n            if (currentTaintedOrigins.has(stackOrigin)) {\n                return true\n            }\n        }\n        return false\n    }\n\n    /\n     * @template {object} P\n     * @typedef {object} ProxyObject<P>\n     * @property {(target?: object, thisArg?: P, args?: object) => void} apply\n     */\n\n    /\n     * @template [P=object]\n     */\n    class DDGProxy {\n        /\n         * @param {import('./content-feature').default} feature\n         * @param {P} objectScope\n         * @param {string} property\n         * @param {ProxyObject<P>} proxyObject\n         */\n        constructor (feature, objectScope, property, proxyObject, taintCheck = false) {\n            this.objectScope = objectScope;\n            this.property = property;\n            this.feature = feature;\n            this.featureName = feature.name;\n            this.camelFeatureName = camelcase(this.featureName);\n            const outputHandler = (...args) => {\n                this.feature.addDebugFlag();\n                let isExempt = shouldExemptMethod(this.camelFeatureName);\n                // If taint checking is enabled for this proxy then we should verify that the method is not tainted and exempt if it isn't\n                if (!isExempt && taintCheck) {\n                    // eslint-disable-next-line @typescript-eslint/no-this-alias\n                    let scope = this;\n                    try {\n                        // @ts-expect-error - Caller doesn't match this\n                        // eslint-disable-next-line no-caller\n                        scope = arguments.callee.caller;\n                    } catch {}\n                    const isTainted = hasTaintedMethod(scope);\n                    isExempt = !isTainted;\n                }\n                // The normal return value\n                if (isExempt) {\n                    return DDGReflect.apply(...args)\n                }\n                return proxyObject.apply(...args)\n            };\n            const getMethod = (target, prop, receiver) => {\n                this.feature.addDebugFlag();\n                if (prop === 'toString') {\n                    const method = Reflect.get(target, prop, receiver).bind(target);\n                    Object.defineProperty(method, 'toString', {\n                        value: String.toString.bind(String.toString),\n                        enumerable: false\n                    });\n                    return method\n                }\n                return DDGReflect.get(target, prop, receiver)\n            };\n            {\n                this._native = objectScope[property];\n                const handler = {};\n                handler.apply = outputHandler;\n                handler.get = getMethod;\n                this.internal = new globalObj.Proxy(objectScope[property], handler);\n            }\n        }\n\n        // Actually apply the proxy to the native property\n        overload () {\n            {\n                this.objectScope[this.property] = this.internal;\n            }\n        }\n\n        overloadDescriptor () {\n            // TODO: this is not always correct! Use wrap or shim* methods instead\n            this.feature.defineProperty(this.objectScope, this.property, {\n                value: this.internal,\n                writable: true,\n                enumerable: true,\n                configurable: true\n            });\n        }\n    }\n\n    const maxCounter = new Map();\n    function numberOfTimesDebugged (feature) {\n        if (!maxCounter.has(feature)) {\n            maxCounter.set(feature, 1);\n        } else {\n            maxCounter.set(feature, maxCounter.get(feature) + 1);\n        }\n        return maxCounter.get(feature)\n    }\n\n    const DEBUG_MAX_TIMES = 5000;\n\n    function postDebugMessage (feature, message, allowNonDebug = false) {\n        if (!allowNonDebug) {\n            return\n        }\n        if (numberOfTimesDebugged(feature) > DEBUG_MAX_TIMES) {\n            return\n        }\n        if (message.stack) {\n            const scriptOrigins = [...getStackTraceOrigins(message.stack)];\n            message.scriptOrigins = scriptOrigins;\n        }\n        globalObj.postMessage({\n            action: feature,\n            message\n        });\n    }\n\n    let DDGReflect;\n\n    // Exports for usage where we have to cross the xray boundary: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts\n    {\n        DDGReflect = globalObj.Reflect;\n    }\n\n    /*\n     * @param {string | null} topLevelHostname\n     * @param {object[]} featureList\n     * @returns {boolean}\n     */\n    function isUnprotectedDomain (topLevelHostname, featureList) {\n        let unprotectedDomain = false;\n        if (!topLevelHostname) {\n            return false\n        }\n        const domainParts = topLevelHostname.split('.');\n\n        // walk up the domain to see if it's unprotected\n        while (domainParts.length > 1 && !unprotectedDomain) {\n            const partialDomain = domainParts.join('.');\n\n            unprotectedDomain = featureList.filter(domain => domain.domain === partialDomain).length > 0;\n\n            domainParts.shift();\n        }\n\n        return unprotectedDomain\n    }\n\n    function parseVersionString (versionString) {\n        return versionString.split('.').map(Number)\n    }\n\n    /\n     * @param {string} minVersionString\n     * @param {string} applicationVersionString\n     * @returns {boolean}\n     */\n    function satisfiesMinVersion (minVersionString, applicationVersionString) {\n        const minVersions = parseVersionString(minVersionString);\n        const currentVersions = parseVersionString(applicationVersionString);\n        const maxLength = Math.max(minVersions.length, currentVersions.length);\n        for (let i = 0; i < maxLength; i++) {\n            const minNumberPart = minVersions[i] || 0;\n            const currentVersionPart = currentVersions[i] || 0;\n            if (currentVersionPart > minNumberPart) {\n                return true\n            }\n            if (currentVersionPart < minNumberPart) {\n                return false\n            }\n        }\n        return true\n    }\n\n    /\n     * @param {string | number | undefined} minSupportedVersion\n     * @param {string | number | undefined} currentVersion\n     * @returns {boolean}\n     */\n    function isSupportedVersion (minSupportedVersion, currentVersion) {\n        if (typeof currentVersion === 'string' && typeof minSupportedVersion === 'string') {\n            if (satisfiesMinVersion(minSupportedVersion, currentVersion)) {\n                return true\n            }\n        } else if (typeof currentVersion === 'number' && typeof minSupportedVersion === 'number') {\n            if (minSupportedVersion <= currentVersion) {\n                return true\n            }\n        }\n        return false\n    }\n\n    /\n     * Retutns a list of enabled features\n     * @param {RemoteConfig} data\n     * @param {string | null} topLevelHostname\n     * @param {Platform['version']} platformVersion\n     * @param {string[]} platformSpecificFeatures\n     * @returns {string[]}\n     */\n    function computeEnabledFeatures (data, topLevelHostname, platformVersion, platformSpecificFeatures = []) {\n        const remoteFeatureNames = Object.keys(data.features);\n        const platformSpecificFeaturesNotInRemoteConfig = platformSpecificFeatures.filter((featureName) => !remoteFeatureNames.includes(featureName));\n        const enabledFeatures = remoteFeatureNames.filter((featureName) => {\n            const feature = data.features[featureName];\n            // Check that the platform supports minSupportedVersion checks and that the feature has a minSupportedVersion\n            if (feature.minSupportedVersion && platformVersion) {\n                if (!isSupportedVersion(feature.minSupportedVersion, platformVersion)) {\n                    return false\n                }\n            }\n            return feature.state === 'enabled' && !isUnprotectedDomain(topLevelHostname, feature.exceptions)\n        }).concat(platformSpecificFeaturesNotInRemoteConfig); // only disable platform specific features if it's explicitly disabled in remote config\n        return enabledFeatures\n    }\n\n    /\n     * Returns the relevant feature settings for the enabled features\n     * @param {RemoteConfig} data\n     * @param {string[]} enabledFeatures\n     * @returns {Record<string, unknown>}\n     */\n    function parseFeatureSettings (data, enabledFeatures) {\n        /* @type {Record<string, unknown>} /\n        const featureSettings = {};\n        const remoteFeatureNames = Object.keys(data.features);\n        remoteFeatureNames.forEach((featureName) => {\n            if (!enabledFeatures.includes(featureName)) {\n                return\n            }\n\n            featureSettings[featureName] = data.features[featureName].settings;\n        });\n        return featureSettings\n    }\n\n    function createCustomEvent (eventName, eventDetail) {\n\n        // @ts-expect-error - possibly null\n        return new OriginalCustomEvent(eventName, eventDetail)\n    }\n\n    /* @deprecated /\n    function legacySendMessage (messageType, options) {\n        // FF & Chrome\n        return originalWindowDispatchEvent && originalWindowDispatchEvent(createCustomEvent('sendMessageProxy' + messageSecret, { detail: { messageType, options } }))\n        // TBD other platforms\n    }\n\n    function _typeof$2(obj) { \"@babel/helpers - typeof\"; return _typeof$2 = \"function\" == typeof Symbol && \"symbol\" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && \"function\" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? \"symbol\" : typeof obj; }, _typeof$2(obj); }\n    function isJSONArray(value) {\n      return Array.isArray(value);\n    }\n    function isJSONObject(value) {\n      return value !== null && _typeof$2(value) === 'object' && value.constructor === Object // do not match on classes or Array\n      ;\n    }\n\n    function _typeof$1(obj) { \"@babel/helpers - typeof\"; return _typeof$1 = \"function\" == typeof Symbol && \"symbol\" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && \"function\" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? \"symbol\" : typeof obj; }, _typeof$1(obj); }\n    /\r\n     * Test deep equality of two JSON values, objects, or arrays\r\n     */ // TODO: write unit tests\n    function isEqual(a, b) {\n      // FIXME: this function will return false for two objects with the same keys\n      //  but different order of keys\n      return JSON.stringify(a) === JSON.stringify(b);\n    }\n\n    /\r\n     * Get all but the last items from an array\r\n     */\n    // TODO: write unit tests\n    function initial(array) {\n      return array.slice(0, array.length - 1);\n    }\n\n    /\r\n     * Get the last item from an array\r\n     */\n    // TODO: write unit tests\n    function last(array) {\n      return array[array.length - 1];\n    }\n\n    /\r\n     * Test whether a value is an Object or an Array (and not a primitive JSON value)\r\n     */\n    // TODO: write unit tests\n    function isObjectOrArray(value) {\n      return _typeof$1(value) === 'object' && value !== null;\n    }\n\n    function _typeof(obj) { \"@babel/helpers - typeof\"; return _typeof = \"function\" == typeof Symbol && \"symbol\" == typeof Symbol.iterator ? function (obj) { return typeof obj; } : function (obj) { return obj && \"function\" == typeof Symbol && obj.constructor === Symbol && obj !== Symbol.prototype ? \"symbol\" : typeof obj; }, _typeof(obj); }\n    function ownKeys(object, enumerableOnly) { var keys = Object.keys(object); if (Object.getOwnPropertySymbols) { var symbols = Object.getOwnPropertySymbols(object); enumerableOnly && (symbols = symbols.filter(function (sym) { return Object.getOwnPropertyDescriptor(object, sym).enumerable; })), keys.push.apply(keys, symbols); } return keys; }\n    function _objectSpread(target) { for (var i = 1; i < arguments.length; i++) { var source = null != arguments[i] ? arguments[i] : {}; i % 2 ? ownKeys(Object(source), !0).forEach(function (key) { _defineProperty(target, key, source[key]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function (key) { Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)); }); } return target; }\n    function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }\n    function _toPropertyKey(arg) { var key = _toPrimitive(arg, \"string\"); return _typeof(key) === \"symbol\" ? key : String(key); }\n    function _toPrimitive(input, hint) { if (_typeof(input) !== \"object\" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || \"default\"); if (_typeof(res) !== \"object\") return res; throw new TypeError(\"@@toPrimitive must return a primitive value.\"); } return (hint === \"string\" ? String : Number)(input); }\n\n    /\n     * Shallow clone of an Object, Array, or value\n     * Symbols are cloned too.\n     */\n    function shallowClone(value) {\n      if (isJSONArray(value)) {\n        // copy array items\n        var copy = value.slice();\n\n        // copy all symbols\n        Object.getOwnPropertySymbols(value).forEach(function (symbol) {\n          // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n          // @ts-ignore\n          copy[symbol] = value[symbol];\n        });\n        return copy;\n      } else if (isJSONObject(value)) {\n        // copy object properties\n        var _copy = _objectSpread({}, value);\n\n        // copy all symbols\n        Object.getOwnPropertySymbols(value).forEach(function (symbol) {\n          // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n          // @ts-ignore\n          _copy[symbol] = value[symbol];\n        });\n        return _copy;\n      } else {\n        return value;\n      }\n    }\n\n    /\n     * Update a value in an object in an immutable way.\n     * If the value is unchanged, the original object will be returned\n     */\n    function applyProp(object, key, value) {\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      if (object[key] === value) {\n        // return original object unchanged when the new value is identical to the old one\n        return object;\n      } else {\n        var updatedObject = shallowClone(object);\n        // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n        // @ts-ignore\n        updatedObject[key] = value;\n        return updatedObject;\n      }\n    }\n\n    /\n     * helper function to get a nested property in an object or array\n     *\n     * @return Returns the field when found, or undefined when the path doesn't exist\n     */\n    function getIn(object, path) {\n      var value = object;\n      var i = 0;\n      while (i < path.length) {\n        if (isJSONObject(value)) {\n          value = value[path[i]];\n        } else if (isJSONArray(value)) {\n          value = value[parseInt(path[i])];\n        } else {\n          value = undefined;\n        }\n        i++;\n      }\n      return value;\n    }\n\n    /\n     * helper function to replace a nested property in an object with a new value\n     * without mutating the object itself.\n     *\n     * @param object\n     * @param path\n     * @param value\n     * @param [createPath=false]\n     *                    If true, path will be created when (partly) missing in\n     *                    the object. For correctly creating nested Arrays or\n     *                    Objects, the function relies on path containing number\n     *                    in case of array indexes.\n     *                    If false (default), an error will be thrown when the\n     *                    path doesn't exist.\n     * @return Returns a new, updated object or array\n     */\n    function setIn(object, path, value) {\n      var createPath = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;\n      if (path.length === 0) {\n        return value;\n      }\n      var key = path[0];\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      var updatedValue = setIn(object ? object[key] : undefined, path.slice(1), value, createPath);\n      if (isJSONObject(object) || isJSONArray(object)) {\n        return applyProp(object, key, updatedValue);\n      } else {\n        if (createPath) {\n          var newObject = IS_INTEGER_REGEX.test(key) ? [] : {};\n          // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n          // @ts-ignore\n          newObject[key] = updatedValue;\n          return newObject;\n        } else {\n          throw new Error('Path does not exist');\n        }\n      }\n    }\n    var IS_INTEGER_REGEX = /^\\d+$/;\n\n    /\n     * helper function to replace a nested property in an object with a new value\n     * without mutating the object itself.\n     *\n     * @return  Returns a new, updated object or array\n     */\n    function updateIn(object, path, callback) {\n      if (path.length === 0) {\n        return callback(object);\n      }\n      if (!isObjectOrArray(object)) {\n        throw new Error('Path doesn\\'t exist');\n      }\n      var key = path[0];\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      var updatedValue = updateIn(object[key], path.slice(1), callback);\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      return applyProp(object, key, updatedValue);\n    }\n\n    /\n     * helper function to delete a nested property in an object\n     * without mutating the object itself.\n     *\n     * @return Returns a new, updated object or array\n     */\n    function deleteIn(object, path) {\n      if (path.length === 0) {\n        return object;\n      }\n      if (!isObjectOrArray(object)) {\n        throw new Error('Path does not exist');\n      }\n      if (path.length === 1) {\n        var _key = path[0];\n        if (!(_key in object)) {\n          // key doesn't exist. return object unchanged\n          return object;\n        } else {\n          var updatedObject = shallowClone(object);\n          if (isJSONArray(updatedObject)) {\n            updatedObject.splice(parseInt(_key), 1);\n          }\n          if (isJSONObject(updatedObject)) {\n            delete updatedObject[_key];\n          }\n          return updatedObject;\n        }\n      }\n      var key = path[0];\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      var updatedValue = deleteIn(object[key], path.slice(1));\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      return applyProp(object, key, updatedValue);\n    }\n\n    /\n     * Insert a new item in an array at a specific index.\n     * Example usage:\n     *\n     *     insertAt({arr: [1,2,3]}, ['arr', '2'], 'inserted')  // [1,2,'inserted',3]\n     */\n    function insertAt(document, path, value) {\n      var parentPath = path.slice(0, path.length - 1);\n      var index = path[path.length - 1];\n      return updateIn(document, parentPath, function (items) {\n        if (!Array.isArray(items)) {\n          throw new TypeError('Array expected at path ' + JSON.stringify(parentPath));\n        }\n        var updatedItems = shallowClone(items);\n        updatedItems.splice(parseInt(index), 0, value);\n        return updatedItems;\n      });\n    }\n\n    /\n     * Test whether a path exists in a JSON object\n     * @return Returns true if the path exists, else returns false\n     */\n    function existsIn(document, path) {\n      if (document === undefined) {\n        return false;\n      }\n      if (path.length === 0) {\n        return true;\n      }\n      if (document === null) {\n        return false;\n      }\n\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      return existsIn(document[path[0]], path.slice(1));\n    }\n\n    /\n     * Parse a JSON Pointer\n     */\n    function parseJSONPointer(pointer) {\n      var path = pointer.split('/');\n      path.shift(); // remove the first empty entry\n\n      return path.map(function (p) {\n        return p.replace(/1/g, '/').replace(/~0/g, '');\n      });\n    }\n\n    /\n     * Compile a JSON Pointer\n     */\n    function compileJSONPointer(path) {\n      return path.map(compileJSONPointerProp).join('');\n    }\n\n    /\n     * Compile a single path property from a JSONPath\n     */\n    function compileJSONPointerProp(pathProp) {\n      return '/' + String(pathProp).replace(/~/g, '~0').replace(/\\//g, '~1');\n    }\n\n    /\n     * Apply a patch to a JSON object\n     * The original JSON object will not be changed,\n     * instead, the patch is applied in an immutable way\n     */\n    function immutableJSONPatch(document, operations, options) {\n      var updatedDocument = document;\n      for (var i = 0; i < operations.length; i++) {\n        validateJSONPatchOperation(operations[i]);\n        var operation = operations[i];\n\n        // TODO: test before\n        if (options && options.before) {\n          var result = options.before(updatedDocument, operation);\n          if (result !== undefined) {\n            if (result.document !== undefined) {\n              updatedDocument = result.document;\n            }\n            // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n            // @ts-ignore\n            if (result.json !== undefined) {\n              // TODO: deprecated since v5.0.0. Cleanup this warning some day\n              throw new Error('Deprecation warning: returned object property \".json\" has been renamed to \".document\"');\n            }\n            if (result.operation !== undefined) {\n              operation = result.operation;\n            }\n          }\n        }\n        var previousDocument = updatedDocument;\n        var path = parsePath(updatedDocument, operation.path);\n        if (operation.op === 'add') {\n          updatedDocument = add(updatedDocument, path, operation.value);\n        } else if (operation.op === 'remove') {\n          updatedDocument = remove(updatedDocument, path);\n        } else if (operation.op === 'replace') {\n          updatedDocument = replace(updatedDocument, path, operation.value);\n        } else if (operation.op === 'copy') {\n          updatedDocument = copy(updatedDocument, path, parseFrom(operation.from));\n        } else if (operation.op === 'move') {\n          updatedDocument = move(updatedDocument, path, parseFrom(operation.from));\n        } else if (operation.op === 'test') {\n          test(updatedDocument, path, operation.value);\n        } else {\n          throw new Error('Unknown JSONPatch operation ' + JSON.stringify(operation));\n        }\n\n        // TODO: test after\n        if (options && options.after) {\n          var _result = options.after(updatedDocument, operation, previousDocument);\n          if (_result !== undefined) {\n            updatedDocument = _result;\n          }\n        }\n      }\n      return updatedDocument;\n    }\n\n    /\n     * Replace an existing item\n     */\n    function replace(document, path, value) {\n      return setIn(document, path, value);\n    }\n\n    /\n     * Remove an item or property\n     */\n    function remove(document, path) {\n      return deleteIn(document, path);\n    }\n\n    /\n     * Add an item or property\n     */\n    function add(document, path, value) {\n      if (isArrayItem(document, path)) {\n        return insertAt(document, path, value);\n      } else {\n        return setIn(document, path, value);\n      }\n    }\n\n    /\n     * Copy a value\n     */\n    function copy(document, path, from) {\n      var value = getIn(document, from);\n      if (isArrayItem(document, path)) {\n        return insertAt(document, path, value);\n      } else {\n        var _value = getIn(document, from);\n        return setIn(document, path, _value);\n      }\n    }\n\n    /\n     * Move a value\n     */\n    function move(document, path, from) {\n      var value = getIn(document, from);\n      // eslint-disable-next-line @typescript-eslint/ban-ts-comment\n      // @ts-ignore\n      var removedJson = deleteIn(document, from);\n      return isArrayItem(removedJson, path) ? insertAt(removedJson, path, value) : setIn(removedJson, path, value);\n    }\n\n    /*\n     * Test whether the data contains the provided value at the specified path.\n     * Throws an error when the test fails\n     */\n    function test(document, path, value) {\n      if (value === undefined) {\n        throw new Error(\"Test failed: no value provided (path: \\\"\".concat(compileJSONPointer(path), \"\\\")\"));\n      }\n      if (!existsIn(document, path)) {\n        throw new Error(\"Test failed: path not found (path: \\\"\".concat(compileJSONPointer(path), \"\\\")\"));\n      }