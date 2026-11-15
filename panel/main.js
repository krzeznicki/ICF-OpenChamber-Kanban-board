"use strict";
(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

  // node_modules/@openchamber/sdk/dist/scrollbar-style.js
  var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
  var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
  function installGuestScrollbarActivity(doc) {
    const root = doc.documentElement;
    if (root.hasAttribute("data-oc-scrollbar-activity"))
      return;
    root.setAttribute("data-oc-scrollbar-activity", "");
    const timers = /* @__PURE__ */ new WeakMap();
    doc.addEventListener("scroll", (event) => {
      const target = event.target === doc ? root : event.target;
      if (!(target instanceof Element))
        return;
      if (!target.hasAttribute("data-oc-scrolling"))
        target.setAttribute("data-oc-scrolling", "");
      const pending = timers.get(target);
      if (pending !== void 0)
        clearTimeout(pending);
      timers.set(target, setTimeout(() => {
        timers.delete(target);
        target.removeAttribute("data-oc-scrolling");
      }, 1e3));
    }, { capture: true, passive: true });
  }
  var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/manifest.js
  var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
  var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
  var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

  // node_modules/@openchamber/sdk/dist/session-events.js
  var GUEST_SESSION_EVENT_TYPES = [
    "turn-finished",
    "turn-failed",
    "permission-asked",
    "question-asked",
    "turn-started",
    "session-created",
    "session-archived",
    "session-deleted"
  ];
  var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
  var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);

  // node_modules/@openchamber/sdk/dist/service-host.js
  var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
  var MENTIONS_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 96e4;
  var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
  var HOST_REQUEST_ERROR_CODES = [
    "HOST_UNAVAILABLE",
    "HOST_TIMEOUT",
    "HOST_REJECTED",
    "DISCONNECTED",
    "DISABLED",
    "BAD_PATH",
    "NO_INTEGRATION",
    "NO_SERVICE",
    "SERVICE_FAILED",
    "REQUEST_FAILED",
    "RESPONSE_TOO_LARGE",
    "NO_SESSION",
    "SESSION_BUSY",
    "NOT_GRANTED",
    "NO_DIRECTORY",
    "NOT_FOUND",
    "FILE_TOO_LARGE",
    "DENIED",
    "NO_MODEL",
    "MODEL_FAILED",
    "UNSUPPORTED"
  ];
  var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
  var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "service-event",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved",
    "generate-late"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const blockListeners = /* @__PURE__ */ new Set();
    const serviceEventListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    const lateGenerateListeners = /* @__PURE__ */ new Set();
    const unclaimedLateGenerate = [];
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const listenForLateGenerate = () => {
      if (disposed || target.parent === target || lateGenerateListeners.size === 0 || lastReady?.features?.lateGenerateResults !== true)
        return;
      post({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "generate-late-listen" });
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        if (message.payload.block)
          emit(blockListeners, message.payload.block);
        listenForLateGenerate();
        return;
      }
      if (message.type === "service-event") {
        emit(serviceEventListeners, message.payload);
        return;
      }
      if (message.type === "generate-late") {
        if (lateGenerateListeners.size === 0)
          unclaimedLateGenerate.push(message.payload);
        else
          emit(lateGenerateListeners, message.payload);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onBlock: (listener) => {
        blockListeners.add(listener);
        if (lastReady?.block)
          listener(lastReady.block);
        return () => {
          blockListeners.delete(listener);
        };
      },
      onServiceEvent: (listener) => {
        serviceEventListeners.add(listener);
        return () => {
          serviceEventListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      answerBlock: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "block-answer",
        id: nextId(ids),
        payload: { text: text.trim().slice(0, GUEST_BLOCK_ANSWER_MAX) }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      onLateGenerateResult: (listener) => {
        lateGenerateListeners.add(listener);
        for (const result of unclaimedLateGenerate.splice(0))
          emit([listener], result);
        listenForLateGenerate();
        return () => {
          lateGenerateListeners.delete(listener);
        };
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        blockListeners.clear();
        serviceEventListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
        lateGenerateListeners.clear();
        unclaimedLateGenerate.length = 0;
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/service-providers.js
  var BROWSER_CONTROL_ACTIONS = [
    "browser.open",
    "browser.snapshot",
    "browser.click",
    "browser.type",
    "browser.select",
    "browser.scroll",
    "browser.back",
    "browser.forward",
    "browser.inspect",
    "browser.capture",
    "browser.resize",
    "browser.close"
  ];
  var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
  var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
  var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
  var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
  var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
  var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/service-surface.js
  var SURFACE_CONTROLLERS = ["none", "agent", "user"];
  var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root.style.setProperty(alias, value);
      root.style.setProperty(hostName, value);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", theme.tokens.fontSize ?? "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusFill = `background-image: linear-gradient(${hover}, ${hover});`;
  var field = (edge, width = "0.5px") => `box-shadow: inset 0 0 0 ${width} ${edge}, var(--oc-sdk-field-lift);`;
  var raised = "border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);";
  var litButton = "box-shadow: var(--oc-sdk-lit);";
  var darkLift = `inset 0 0.5px 0 0 ${mix(fg, 8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`;
  var THEME_VARS = `
:root {
  --oc-sdk-edge: ${mix(fg, 16)};
  --oc-sdk-field-bg: ${elevated};
  --oc-sdk-raised-bg: ${bg};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${mix(fg, 14)};
  --oc-sdk-field-bg: ${mix(bg, 50, elevated)};
  --oc-sdk-raised-bg: ${elevated};
  --oc-sdk-field-lift: ${darkLift};
  --oc-sdk-raised-lift: ${darkLift};
  --oc-sdk-lit: ${darkLift};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var len = (px) => `calc(${px}rem / 14)`;
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${len(8)}; height: ${len(32)}; padding: 0 ${len(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${len(4)}; height: ${len(24)}; padding: 0 ${len(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${len(14)}; height: ${len(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${len(32)}; padding: 0 ${len(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${len(8)} ${len(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${len(34)}; padding-right: ${len(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${len(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${len(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${len(24)}; height: ${len(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${len(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${len(2)}; min-width: ${len(160)}; max-width: calc(100vw - ${len(16)}); max-height: min(${len(320)}, calc(100vh - ${len(16)})); overflow: auto; padding: ${len(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${len(2)} ${len(2)} ${len(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${len(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${len(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${len(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${len(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${len(14)}; height: ${len(14)}; margin-top: ${len(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${len(36)}; height: ${len(20)}; --oc-sdk-thumb-travel: ${len(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${len(2)}; left: ${len(2)}; width: ${len(16)}; height: ${len(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${len(2)}; padding: ${len(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${len(1)} ${len(6)}; font-size: ${len(11)}; font-weight: 500; line-height: ${len(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${len(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${len(16)} ${len(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${len(4)}; padding: ${len(40)} ${len(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${len(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${len(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${len(16)}; height: ${len(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${len(12)}; height: ${len(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${len(12)}; padding: ${len(8)} ${len(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${len(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${len(8)}; width: 100%; margin: ${len(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${len(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${len(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${len(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${len(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${len(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${len(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${len(36)}; height: ${len(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${len(44)}; }
  .oc-sdk-check { min-height: ${len(36)}; padding: ${len(8)} 0; }
}
`;
  var GUEST_UI_LOOK_CSS = `${THEME_VARS}
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${focusFill} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; ${litButton} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; ${litButton} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; box-shadow: none; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: var(--oc-sdk-field-bg); color: ${elevatedFg}; ${field("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${field(mix(fg, 26), "1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${field(v("status-error", "red"), "1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-radius: ${controlRadius}; background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${elevated}; background-clip: padding-box; color: ${elevatedFg}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusFill} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${elevatedFg}; background: var(--oc-sdk-raised-bg); ${raised} }
.oc-sdk-tab-count { color: ${muted}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${mix(fg, 6)}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${mix(fg, 6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${v("status-success", "currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${v("success-text", "inherit")}; }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // node_modules/@openchamber/sdk/dist/ui/dom.js
  var STYLE_ID = "oc-sdk-ui-style";
  var clearNode = (node) => {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  };
  var ensureStyle = (css) => {
    const existing = document.getElementById(STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
      if (existing.textContent !== css) {
        existing.textContent = css;
      }
      return;
    }
    installGuestScrollbarActivity(document);
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };
  var el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  };
  var button = (className) => {
    const node = el("button", className);
    node.type = "button";
    return node;
  };
  var setText = (node, text) => {
    const next = text ?? "";
    if (node.textContent !== next) {
      node.textContent = next;
    }
  };
  var setAttr = (node, name, value) => {
    if (value === void 0 || value === null || value === "") {
      node.removeAttribute(name);
    } else if (node.getAttribute(name) !== value) {
      node.setAttribute(name, value);
    }
  };
  var onOutsideClick = (node, handler) => {
    const listener = (event) => {
      if (event.target instanceof Node && node.contains(event.target)) {
        return;
      }
      handler();
    };
    document.addEventListener("pointerdown", listener, true);
    return () => {
      document.removeEventListener("pointerdown", listener, true);
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/button.js
  var ring = () => {
    const spinner = document.createElement("span");
    spinner.className = "oc-sdk-spinner-ring";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  };
  var mountButton = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-btn");
    const spinner = ring();
    const label = document.createElement("span");
    node.append(label);
    root.append(node);
    const paint = () => {
      node.dataset.variant = props.variant ?? "default";
      node.dataset.size = props.size ?? "default";
      node.disabled = Boolean(props.disabled) || Boolean(props.loading);
      node.dataset.loading = props.loading ? "true" : "false";
      node.setAttribute("aria-busy", props.loading ? "true" : "false");
      if (props.loading && spinner.parentNode !== node) {
        node.prepend(spinner);
      } else if (!props.loading && spinner.parentNode === node) {
        spinner.remove();
      }
      setText(label, props.label);
    };
    const onClick = () => {
      if (props.disabled || props.loading) {
        return;
      }
      props.onClick();
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/field.js
  var mountTextField = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const field2 = el("label", "oc-sdk oc-sdk-field");
    const caption = el("span", "oc-sdk-field-label");
    const input = props.multiline ? el("textarea", "oc-sdk-input") : el("input", "oc-sdk-input");
    const note = el("span", "oc-sdk-field-note");
    field2.append(caption, input, note);
    root.append(field2);
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      if (input instanceof HTMLInputElement) {
        input.type = props.password ? "password" : "text";
      } else {
        input.rows = props.rows ?? 3;
      }
      if (input.value !== props.value) {
        input.value = props.value;
      }
      input.disabled = Boolean(props.disabled);
      setAttr(input, "placeholder", props.placeholder);
      input.dataset.mono = props.mono ? "true" : "false";
      const invalid = Boolean(props.error);
      field2.dataset.invalid = invalid ? "true" : "false";
      input.setAttribute("aria-invalid", invalid ? "true" : "false");
      const text = props.error ?? props.helper ?? "";
      setText(note, text);
      note.hidden = text === "";
    };
    const onInput = () => {
      props.onChange(input.value);
    };
    input.addEventListener("input", onInput);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        input.removeEventListener("input", onInput);
        field2.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/icons.js
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ICON_PATH = {
    search: "M18.031 16.617l4.283 4.282-1.415 1.415-4.282-4.283A8.96 8.96 0 0 1 11 20c-4.968 0-9-4.032-9-9s4.032-9 9-9 9 4.032 9 9a8.96 8.96 0 0 1-1.969 5.617zm-2.006-.742A6.977 6.977 0 0 0 18 11c0-3.868-3.133-7-7-7-3.868 0-7 3.132-7 7 0 3.867 3.132 7 7 7a6.977 6.977 0 0 0 4.875-1.975l.15-.15z",
    chevron: "M12 13.172l4.95-4.95 1.414 1.414L12 16 5.636 9.636 7.05 8.222z",
    check: "M10 15.172l9.192-9.193 1.415 1.414L10 18l-6.364-6.364 1.414-1.414z",
    close: "M12 10.586l4.95-4.95 1.414 1.414-4.95 4.95 4.95 4.95-1.414 1.414-4.95-4.95-4.95 4.95-1.414-1.414 4.95-4.95-4.95-4.95L7.05 5.636z"
  };
  var icon = (name, size, className) => {
    const node = document.createElementNS(SVG_NS, "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("width", String(size));
    node.setAttribute("height", String(size));
    node.style.width = len(size);
    node.style.height = len(size);
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("fill", "currentColor");
    if (className) {
      node.setAttribute("class", className);
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", ICON_PATH[name]);
    node.append(path);
    return node;
  };

  // node_modules/@openchamber/sdk/dist/ui/navigation.js
  var navigationKey = (event, axis = "vertical") => {
    const [next, previous] = axis === "vertical" ? ["ArrowDown", "ArrowUp"] : ["ArrowRight", "ArrowLeft"];
    if (event.key === next || event.ctrlKey && event.key.toLowerCase() === "n")
      return "next";
    if (event.key === previous || event.ctrlKey && event.key.toLowerCase() === "p")
      return "previous";
    if (event.key === "Home")
      return "first";
    if (event.key === "End")
      return "last";
    return null;
  };
  var moveListSelection = (items, currentId, key) => {
    const enabled = items.filter((item) => !item.disabled);
    if (enabled.length === 0) {
      return null;
    }
    const first = enabled[0];
    const last = enabled[enabled.length - 1];
    if (key === "first" || !first || !last) {
      return first?.id ?? null;
    }
    if (key === "last") {
      return last.id;
    }
    const index = enabled.findIndex((item) => item.id === currentId);
    if (index === -1) {
      return key === "next" ? first.id : last.id;
    }
    const target = enabled[Math.min(enabled.length - 1, Math.max(0, index + (key === "next" ? 1 : -1)))];
    return target?.id ?? null;
  };

  // node_modules/@openchamber/sdk/dist/ui/option.js
  var optionId = (uid, id) => `${uid}-${id ?? ""}`;
  var createOption = (uid, role, spec, on) => {
    const node = button("oc-sdk-option");
    node.id = optionId(uid, spec.id);
    node.setAttribute("role", role);
    node.tabIndex = -1;
    node.disabled = Boolean(spec.disabled);
    if (role === "option") {
      node.setAttribute("aria-selected", spec.selected ? "true" : "false");
    }
    node.dataset.destructive = spec.destructive ? "true" : "false";
    const label = el("span", "oc-sdk-option-label");
    label.textContent = spec.label;
    node.append(label);
    if (spec.hint) {
      const hint = el("span", "oc-sdk-option-hint");
      hint.textContent = spec.hint;
      node.append(hint);
    }
    if (role === "option") {
      node.dataset.mark = "check";
      const check = el("span", "oc-sdk-option-check");
      check.append(icon("check", 14));
      node.append(check);
    }
    node.addEventListener("pointerenter", on.hover);
    node.addEventListener("click", on.pick);
    return node;
  };
  var highlightOption = (container, focusOwner, uid, id) => {
    const target = optionId(uid, id);
    for (const child of Array.from(container.children)) {
      if (child instanceof HTMLElement && child.classList.contains("oc-sdk-option")) {
        child.dataset.active = child.id === target ? "true" : "false";
      }
    }
    setAttr(focusOwner, "aria-activedescendant", id ? target : null);
    container.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  };

  // node_modules/@openchamber/sdk/dist/ui/popup.js
  var placePopup = (popup, trigger) => {
    const rect = trigger.getBoundingClientRect();
    popup.style.minWidth = `${Math.round(rect.width)}px`;
    popup.style.left = `${Math.round(rect.left)}px`;
    popup.style.top = `${Math.round(rect.bottom + 4)}px`;
    const height = popup.offsetHeight;
    const roomBelow = window.innerHeight - rect.bottom - 8;
    if (height > roomBelow && rect.top - 8 > roomBelow) {
      popup.style.top = `${Math.max(8, Math.round(rect.top - 4 - height))}px`;
    }
    const overflow = rect.left + popup.offsetWidth - window.innerWidth + 8;
    if (overflow > 0) {
      popup.style.left = `${Math.max(8, Math.round(rect.left - overflow))}px`;
    }
  };
  var openPopup = (host2, trigger, popup, close) => {
    host2.append(popup);
    placePopup(popup, trigger);
    const stopOutside = onOutsideClick(host2, close);
    const onResize = () => {
      close();
    };
    const onScroll = (event) => {
      if (event.target instanceof Node && popup.contains(event.target)) {
        return;
      }
      close();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      stopOutside();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
      popup.remove();
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/select.js
  var filterSelectOptions = (options, query) => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [...options];
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle) || option.id.toLowerCase().includes(needle));
  };
  var selectCount = 0;
  var mountSelect = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const uid = `oc-sdk-select-${selectCount += 1}`;
    const wrap = el("div", "oc-sdk oc-sdk-select");
    const caption = el("span", "oc-sdk-field-label");
    caption.id = `${uid}-label`;
    const trigger = button("oc-sdk-trigger");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-labelledby", caption.id);
    const value = el("span", "oc-sdk-trigger-value");
    trigger.append(value, icon("chevron", 14, "oc-sdk-trigger-chevron"));
    wrap.append(caption, trigger);
    root.append(wrap);
    let query = "";
    let activeId = null;
    let closePopup = null;
    const popup = el("div", "oc-sdk oc-sdk-popup");
    const searchSlot = el("div", "oc-sdk-popup-search");
    const search = el("input", "oc-sdk-input");
    search.type = "text";
    search.autocomplete = "off";
    searchSlot.append(search);
    const listbox = el("div");
    listbox.setAttribute("role", "listbox");
    listbox.tabIndex = -1;
    popup.append(listbox);
    const visible = () => filterSelectOptions(props.options, props.searchable ? query : "");
    const focusOwner = () => props.searchable ? search : listbox;
    const setActive = (id) => {
      activeId = id;
      highlightOption(listbox, focusOwner(), uid, id);
    };
    const paintOptions = () => {
      clearNode(listbox);
      const options = visible();
      if (options.length === 0) {
        const empty = el("div", "oc-sdk-popup-empty");
        empty.textContent = "No matches";
        listbox.append(empty);
      }
      for (const option of options) {
        listbox.append(createOption(uid, "option", { ...option, selected: option.id === props.value }, {
          hover: () => setActive(option.id),
          pick: () => pick(option.id)
        }));
      }
      setActive(options.some((option) => option.id === activeId) ? activeId : options[0]?.id ?? null);
    };
    const close = () => {
      const dispose = closePopup;
      closePopup = null;
      dispose?.();
      query = "";
      search.value = "";
      trigger.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      if (closePopup || props.disabled) {
        return;
      }
      activeId = props.value;
      search.placeholder = props.searchPlaceholder ?? "Search";
      if (props.searchable)
        popup.prepend(searchSlot);
      else
        searchSlot.remove();
      paintOptions();
      closePopup = openPopup(wrap, trigger, popup, close);
      trigger.setAttribute("aria-expanded", "true");
      focusOwner().focus();
    };
    const pick = (id) => {
      close();
      trigger.focus();
      if (id !== props.value)
        props.onChange(id);
    };
    const onTriggerClick = () => {
      if (closePopup)
        close();
      else
        open();
    };
    const onTriggerKey = (event) => {
      if (!closePopup && navigationKey(event)) {
        event.preventDefault();
        open();
      }
    };
    const onPopupKey = (event) => {
      const step2 = navigationKey(event);
      if (step2) {
        event.preventDefault();
        setActive(moveListSelection(visible(), activeId, step2));
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeId)
          pick(activeId);
      } else if (event.key === "Escape") {
        event.preventDefault();
        close();
        trigger.focus();
      } else if (props.searchable && event.target !== search && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        search.focus();
      }
    };
    const onSearchInput = () => {
      query = search.value;
      paintOptions();
    };
    const onFocusOut = (event) => {
      if (closePopup && !(event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)))
        close();
    };
    const paint = () => {
      setText(caption, props.label);
      caption.hidden = !props.label;
      const current = props.options.find((option) => option.id === props.value);
      setText(value, current?.label ?? props.placeholder ?? "Select");
      value.dataset.empty = current ? "false" : "true";
      trigger.disabled = Boolean(props.disabled);
      if (closePopup)
        paintOptions();
    };
    trigger.addEventListener("click", onTriggerClick);
    trigger.addEventListener("keydown", onTriggerKey);
    popup.addEventListener("keydown", onPopupKey);
    search.addEventListener("input", onSearchInput);
    wrap.addEventListener("focusout", onFocusOut);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        close();
        trigger.removeEventListener("click", onTriggerClick);
        trigger.removeEventListener("keydown", onTriggerKey);
        popup.removeEventListener("keydown", onPopupKey);
        search.removeEventListener("input", onSearchInput);
        wrap.removeEventListener("focusout", onFocusOut);
        wrap.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/checkbox.js
  var mountToggle = (root, initial, role) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-check");
    node.setAttribute("role", role);
    const control = el("span", role === "switch" ? "oc-sdk-check-thumb" : "oc-sdk-check-box");
    if (role === "checkbox") {
      control.append(icon("check", 12));
    }
    const text = el("span", "oc-sdk-check-text");
    const label = el("span", "oc-sdk-check-label");
    const description = el("span", "oc-sdk-check-desc");
    text.append(label, description);
    node.append(control, text);
    root.append(node);
    const paint = () => {
      node.setAttribute("aria-checked", props.checked ? "true" : "false");
      node.disabled = Boolean(props.disabled);
      setText(label, props.label);
      setText(description, props.description);
      description.hidden = !props.description;
    };
    const onClick = () => {
      if (!props.disabled) {
        props.onChange(!props.checked);
      }
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };
  var mountSwitch = (root, initial) => mountToggle(root, initial, "switch");

  // node_modules/@openchamber/sdk/dist/ui/badge.js
  var applyTone = (node, tone2) => {
    setAttr(node, "data-tone", tone2 && tone2 !== "neutral" ? tone2 : null);
  };
  var mountBadge = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-badge");
    root.append(node);
    const paint = () => {
      setText(node, props.label);
      applyTone(node, props.tone);
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/list.js
  var listCount = 0;
  var mountList = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const uid = `oc-sdk-list-${listCount += 1}`;
    const list = el("div", "oc-sdk oc-sdk-list");
    list.setAttribute("role", "listbox");
    list.tabIndex = 0;
    root.append(list);
    let activeId = null;
    const rowId = (id) => `${uid}-${id}`;
    const setActive = (id) => {
      activeId = id;
      for (const row of Array.from(list.children)) {
        if (row instanceof HTMLElement) {
          row.dataset.active = row.id === rowId(id ?? "") ? "true" : "false";
        }
      }
      setAttr(list, "aria-activedescendant", id ? rowId(id) : null);
      list.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
    };
    const span = (className, text) => {
      const node = el("span", className);
      node.textContent = text;
      return node;
    };
    const paint = () => {
      clearNode(list);
      setAttr(list, "aria-label", props.ariaLabel);
      if (props.items.length === 0) {
        list.append(span("oc-sdk-list-empty", props.emptyText ?? "Nothing here"));
        setActive(null);
        return;
      }
      for (const item of props.items) {
        const row = button("oc-sdk-row");
        row.id = rowId(item.id);
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", item.id === props.selectedId ? "true" : "false");
        row.disabled = Boolean(item.disabled);
        row.tabIndex = -1;
        if (item.leading)
          row.append(span("oc-sdk-row-lead", item.leading));
        const main = el("span", "oc-sdk-row-main");
        main.append(span("oc-sdk-row-title", item.title));
        if (item.subtitle)
          main.append(span("oc-sdk-row-sub", item.subtitle));
        row.append(main);
        if (item.badge) {
          const badge = span("oc-sdk-badge", item.badge.label);
          applyTone(badge, item.badge.tone);
          row.append(badge);
        }
        if (item.meta)
          row.append(span("oc-sdk-row-meta", item.meta));
        row.addEventListener("click", () => props.onSelect(item.id));
        list.append(row);
      }
      const stillThere = props.items.some((item) => item.id === activeId && !item.disabled);
      setActive(stillThere ? activeId : props.selectedId ?? null);
    };
    const onKeyDown = (event) => {
      const step2 = navigationKey(event);
      if (step2) {
        event.preventDefault();
        setActive(moveListSelection(props.items, activeId, step2));
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && activeId) {
        event.preventDefault();
        props.onSelect(activeId);
      }
    };
    list.addEventListener("keydown", onKeyDown);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        list.removeEventListener("keydown", onKeyDown);
        list.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/empty.js
  var mountEmpty = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const shell = el("div", "oc-sdk oc-sdk-empty");
    const title = el("h2", "oc-sdk-empty-title");
    const body = el("p", "oc-sdk-empty-body");
    const slot = el("div", "oc-sdk-empty-action");
    shell.append(title, body, slot);
    root.append(shell);
    let action = null;
    const paint = () => {
      setText(title, props.title);
      setText(body, props.body);
      body.hidden = !props.body;
      slot.hidden = !props.action;
      if (!props.action) {
        action?.dispose();
        action = null;
        return;
      }
      const next = { label: props.action.label, onClick: props.action.onClick };
      if (action) {
        action.update(next);
      } else {
        action = mountButton(slot, { ...next, variant: "outline", size: "sm" });
      }
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        action?.dispose();
        action = null;
        shell.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/spinner.js
  var mountSpinner = (root, initial = {}) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("span", "oc-sdk oc-sdk-spinner");
    node.setAttribute("role", "status");
    const ring2 = el("span", "oc-sdk-spinner-ring");
    ring2.setAttribute("aria-hidden", "true");
    const label = el("span");
    node.append(ring2, label);
    root.append(node);
    const paint = () => {
      node.dataset.size = props.size ?? "default";
      setText(label, props.label);
      label.hidden = !props.label;
      node.setAttribute("aria-label", props.label ?? "Loading");
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/banner.js
  var mountBanner = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-banner");
    const text = el("div", "oc-sdk-banner-text");
    const title = el("div", "oc-sdk-banner-title");
    const body = el("div", "oc-sdk-banner-body");
    const slot = el("div", "oc-sdk-banner-action");
    text.append(title, body);
    node.append(text, slot);
    root.append(node);
    let action = null;
    const paint = () => {
      node.dataset.tone = props.tone;
      node.setAttribute("role", props.tone === "error" || props.tone === "warning" ? "alert" : "status");
      setText(title, props.title);
      setText(body, props.body);
      body.hidden = !props.body;
      slot.hidden = !props.action;
      if (!props.action) {
        action?.dispose();
        action = null;
        return;
      }
      const next = { label: props.action.label, onClick: props.action.onClick };
      if (action) {
        action.update(next);
      } else {
        action = mountButton(slot, { ...next, variant: "outline", size: "xs" });
      }
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        action?.dispose();
        action = null;
        node.remove();
      }
    };
  };

  // node_modules/@openchamber/sdk/dist/ui/progress.js
  var clampProgress = (value) => Number.isFinite(value) ? Math.min(100, Math.max(0, Math.floor(value))) : 0;
  var mountProgress = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = el("div", "oc-sdk oc-sdk-progress");
    const caption = el("div", "oc-sdk-progress-label");
    const label = el("span");
    const percent = el("span", "oc-sdk-progress-value");
    const percentText = el("span");
    const doneMark = icon("check", 14);
    percent.append(doneMark, percentText);
    caption.append(label, percent);
    const track = el("div", "oc-sdk-progress-track");
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const fill = el("div", "oc-sdk-progress-fill");
    track.append(fill);
    node.append(caption, track);
    root.append(node);
    const paint = () => {
      const value = clampProgress(props.value);
      applyTone(fill, props.tone);
      fill.style.transform = `scaleX(${value / 100})`;
      track.setAttribute("aria-valuenow", String(value));
      if (props.label)
        track.setAttribute("aria-label", props.label);
      else
        track.removeAttribute("aria-label");
      setText(label, props.label);
      setText(percentText, `${value}%`);
      const done = value === 100 && (!props.tone || props.tone === "neutral");
      setAttr(node, "data-done", done ? "true" : null);
      doneMark.style.display = done ? "" : "none";
      caption.hidden = !props.label;
    };
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.remove();
      }
    };
  };

  // src/panel/api.ts
  var ApiError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "ApiError";
      this.code = code;
    }
  };
  var parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  var errorOf = (json, status) => {
    const e = json?.error;
    const code = typeof e?.code === "string" ? e.code : "FAILED";
    const message = typeof e?.message === "string" ? e.message : `The service answered ${status}`;
    return new ApiError(code, message);
  };
  var createApi = (host2, directory) => {
    const call = async (method, path, body) => {
      let res;
      try {
        res = await host2.serviceRequest({
          method,
          path,
          ...method === "POST" ? { body: JSON.stringify({ ...body, directory }) } : {}
        });
      } catch (e) {
        const code = typeof e.code === "string" ? e.code : "FAILED";
        throw new ApiError(code, e instanceof Error ? e.message : String(e));
      }
      const json = parse(res.body);
      if (res.status !== 200) throw errorOf(json, res.status);
      return json;
    };
    return {
      directory,
      readConfig: () => call("POST", "/config/read"),
      initConfig: (tracker) => call("POST", "/config/init", { tracker }).then((r) => r.config),
      /** The github.com remote of the project (origin first), or null. */
      detect: () => call("POST", "/config/detect").then((r) => r.remote),
      list: () => call("POST", "/tasks/list").then((r) => r.tasks),
      get: (id) => call("POST", "/tasks/get", { id }).then((r) => r.task),
      create: (input) => call("POST", "/tasks/create", { input }).then((r) => r.task),
      setState: (id, state2) => call("POST", "/tasks/state", { id, state: state2 }).then((r) => r.task),
      setType: (id, type) => call("POST", "/tasks/type", { id, type }).then((r) => r.task),
      close: (id, withChildren = false) => call("POST", "/tasks/close", { id, withChildren }).then((r) => r.tasks),
      cliPath: () => call("GET", "/cli").then((r) => r.path)
    };
  };

  // src/panel/columns.ts
  var COLUMNS = [
    { id: "backlog", title: "Backlog" },
    { id: "ready", title: "Ready" },
    { id: "in_progress", title: "In Progress" },
    { id: "review", title: "Review" },
    { id: "done", title: "Done" }
  ];
  var columnFor = (task, session, queued) => {
    if (task.state === "done") return "done";
    if (queued) return "in_progress";
    if (session !== null && !session.archived) {
      const a = session.activity;
      if (a === "running" || a === "retrying") return "in_progress";
      if (a === "waiting-permission" || a === "waiting-question") return "review";
      if (a === "idle" && session.outcome !== null) return "review";
    }
    return task.state === "ready-for-agent" ? "ready" : "backlog";
  };
  var sessionForTask = (taskId, sessions) => {
    let best = null;
    for (const s of sessions) {
      if (s.archivedAt !== null) continue;
      if (!s.items.some((item) => item.id === taskId)) continue;
      if (best === null || s.createdAt > best.createdAt || s.createdAt === best.createdAt && s.updatedAt > best.updatedAt) {
        best = s;
      }
    }
    return best === null ? null : { id: best.id, activity: best.activity, outcome: best.outcome, archived: false };
  };
  var groupTasks = (tasks, sessions, queued, hideSubtasks) => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const children = /* @__PURE__ */ new Map();
    for (const t of tasks) {
      if (t.parentId === null || !byId.has(t.parentId)) continue;
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    }
    const cards = /* @__PURE__ */ new Map();
    for (const task of tasks) {
      if (hideSubtasks && task.parentId !== null) continue;
      const session = sessionForTask(task.id, sessions);
      const kids = children.get(task.id) ?? [];
      cards.set(task.id, {
        column: columnFor(task, session, queued.has(task.id)),
        card: {
          task,
          session,
          blockers: task.blockedBy.filter((id) => {
            const b = byId.get(id);
            return b !== void 0 && b.state !== "done";
          }),
          progress: kids.length === 0 ? null : { done: kids.filter((k) => k.state === "done").length, total: kids.length },
          child: false
        }
      });
    }
    const board2 = { backlog: [], ready: [], in_progress: [], review: [], done: [] };
    const placed = /* @__PURE__ */ new Set();
    for (const task of tasks) {
      const entry = cards.get(task.id);
      if (entry === void 0 || placed.has(task.id)) continue;
      const parent = task.parentId === null ? void 0 : cards.get(task.parentId);
      if (parent !== void 0 && parent.column === entry.column && !placed.has(task.parentId)) continue;
      board2[entry.column].push(entry.card);
      placed.add(task.id);
      for (const kid of children.get(task.id) ?? []) {
        const k = cards.get(kid.id);
        if (k === void 0 || placed.has(kid.id) || k.column !== entry.column) continue;
        board2[entry.column].push({ ...k.card, child: true });
        placed.add(kid.id);
      }
    }
    return board2;
  };

  // src/panel/moves.ts
  var planMove = (task, from, to, openChildren2) => {
    if (from === to) return { kind: "none", reason: "The task is already in this column" };
    switch (to) {
      case "backlog":
        return { kind: "setState", state: "needs-triage" };
      case "ready":
        return { kind: "setState", state: "ready-for-agent" };
      case "in_progress":
        return task.state === "done" || from === "done" ? { kind: "none", reason: "Reopen the task (move it to Backlog or Ready) before starting it" } : { kind: "start" };
      case "review":
        return { kind: "none", reason: "Review is set by the agent's session" };
      case "done":
        return { kind: "close", askChildren: openChildren2 > 0 };
    }
  };
  var openChildren = (task, tasks) => tasks.filter((t) => t.parentId === task.id && t.state !== "done").length;
  var BASE_TYPES = ["enhancement", "bug", "chore", "research"];
  var taskTypes = (tasks) => {
    const used = /* @__PURE__ */ new Set();
    for (const t of tasks) if (t.type !== null && t.type.trim() !== "" && !BASE_TYPES.includes(t.type)) used.add(t.type);
    return [...BASE_TYPES, ...[...used].sort()];
  };

  // src/panel/ui/add.ts
  var NONE = "";
  var mountAddForm = (root, model, callbacks) => {
    const form = document.createElement("form");
    form.className = "kb-add";
    form.noValidate = true;
    const slot = (className) => {
      const d = document.createElement("div");
      d.className = className;
      form.append(d);
      return d;
    };
    const titleSlot = slot("kb-add-title");
    const row = slot("kb-fields");
    const typeSlot = document.createElement("div");
    typeSlot.className = "kb-field";
    const parentSlot = document.createElement("div");
    parentSlot.className = "kb-field";
    row.append(typeSlot, parentSlot);
    const bodySlot = slot("kb-add-body");
    const errorSlot = slot("kb-add-error");
    const actions = slot("kb-actions");
    root.replaceChildren(form);
    let title = "";
    let body = "";
    let type = "enhancement";
    let parent = NONE;
    let busy = false;
    let errorDispose = null;
    const titleField = mountTextField(titleSlot, {
      label: "Title",
      value: "",
      placeholder: "What should be done?",
      onChange: (v2) => {
        title = v2;
        titleField.update({ value: v2, ...v2.trim() !== "" ? { error: void 0 } : {} });
      }
    });
    const typeSelect = mountSelect(typeSlot, {
      label: "Type",
      value: type,
      options: [{ id: NONE, label: "No type" }, ...model.types.map((t) => ({ id: t, label: t }))],
      onChange: (id) => {
        type = id;
        typeSelect.update({ value: id });
      }
    });
    const noParent = model.tracker === "local" ? "None (new feature)" : "None";
    const parentSelect = mountSelect(parentSlot, {
      label: "Parent",
      value: parent,
      options: [{ id: NONE, label: noParent }, ...model.parents],
      searchable: model.parents.length > 8,
      onChange: (id) => {
        parent = id;
        parentSelect.update({ value: id });
      }
    });
    const bodyField = mountTextField(bodySlot, {
      label: "Description",
      value: "",
      multiline: true,
      rows: 3,
      placeholder: "A few sentences: what and why.",
      onChange: (v2) => {
        body = v2;
        bodyField.update({ value: v2 });
      }
    });
    const create = mountButton(actions, { label: "Create in Backlog", size: "sm", onClick: () => submit() });
    const cancel = mountButton(actions, { label: "Cancel", variant: "outline", size: "sm", onClick: () => callbacks.onCancel() });
    const showError = (message) => {
      errorDispose?.();
      errorDispose = null;
      if (message !== null) errorDispose = mountBanner(errorSlot, { tone: "error", title: "Could not create the task", body: message }).dispose;
    };
    const setBusy = (next) => {
      busy = next;
      create.update({ loading: next, disabled: next });
      cancel.update({ disabled: next });
      titleField.update({ disabled: next });
      bodyField.update({ disabled: next });
      typeSelect.update({ disabled: next });
      parentSelect.update({ disabled: next });
    };
    const submit = () => {
      if (busy) return;
      const t = title.trim();
      if (t === "") {
        titleField.update({ error: "A title is required" });
        form.querySelector(".kb-add-title input")?.focus();
        return;
      }
      showError(null);
      setBusy(true);
      const input = {
        title: t,
        state: "needs-triage",
        ...body.trim() !== "" ? { body: body.trim() } : {},
        ...type !== NONE ? { type } : {},
        ...parent !== NONE ? { parentId: parent } : {}
      };
      void callbacks.onSubmit(input).then((error) => {
        if (!form.isConnected) return;
        setBusy(false);
        showError(error);
      });
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !e.defaultPrevented && !busy) callbacks.onCancel();
    });
    form.querySelector(".kb-add-title input")?.focus();
    return () => {
      errorDispose?.();
      for (const h of [titleField, typeSelect, parentSelect, bodyField, create, cancel]) h.dispose();
      form.remove();
    };
  };

  // src/panel/ui/confirm.ts
  var askChoice = (title, body, choices) => new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "kb-backdrop kb-confirm-backdrop";
    const box = document.createElement("div");
    box.className = "kb-confirm";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    const head = document.createElement("h2");
    head.className = "kb-confirm-title";
    head.textContent = title;
    const text = document.createElement("p");
    text.className = "kb-confirm-body";
    text.textContent = body;
    const actions = document.createElement("div");
    actions.className = "kb-actions";
    box.append(head, text, actions);
    backdrop.append(box);
    const disposers = [];
    const done = (answer) => {
      document.removeEventListener("keydown", onKey, true);
      for (const d of disposers) d();
      backdrop.remove();
      resolve(answer);
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      done(null);
    };
    for (const c of choices) {
      disposers.push(mountButton(actions, { label: c.label, variant: c.variant ?? "default", size: "sm", onClick: () => done(c.id) }).dispose);
    }
    disposers.push(mountButton(actions, { label: "Cancel", variant: "outline", size: "sm", onClick: () => done(null) }).dispose);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) done(null);
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    actions.querySelector("button")?.focus();
  });

  // src/panel/ui/detail.ts
  var STATES = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix", "done"];
  var el2 = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  var openDetail = (initial, callbacks) => {
    const backdrop = el2("div", "kb-backdrop");
    const sheet = el2("aside", "kb-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.tabIndex = -1;
    backdrop.append(sheet);
    document.body.append(backdrop);
    let disposers = [];
    const clear = () => {
      for (const d of disposers) d();
      disposers = [];
      sheet.replaceChildren();
    };
    const draw2 = (m) => {
      clear();
      const { task } = m;
      sheet.setAttribute("aria-label", task.title);
      sheet.setAttribute("aria-busy", String(m.busy));
      const head = el2("div", "kb-sheet-head");
      const titles = el2("div", "kb-sheet-titles");
      titles.append(el2("h2", "kb-sheet-title", task.title), el2("div", "kb-card-id", task.id));
      const closeSlot = el2("div", "kb-sheet-x");
      head.append(titles, closeSlot);
      disposers.push(mountButton(closeSlot, { label: "Done", variant: "ghost", size: "sm", onClick: callbacks.onDismiss }).dispose);
      sheet.append(head);
      const badges = el2("div", "kb-badges");
      if (task.kind === "parent") disposers.push(mountBadge(badges, { label: "parent", tone: "primary" }).dispose);
      if (m.busy) {
        const spin = el2("span", "kb-inline-spin");
        badges.append(spin);
        disposers.push(mountSpinner(spin, { size: "sm", label: "Saving" }).dispose);
      }
      sheet.append(badges);
      const meta = el2("dl", "kb-meta");
      const row = (term, value) => {
        meta.append(el2("dt", "", term), el2("dd", "", value));
      };
      if (task.parentId !== null) row("Parent", task.parentId);
      if (task.blockedBy.length > 0) row("Blocked by", task.blockedBy.join(", "));
      if (m.openChildren > 0) row("Open sub-tasks", String(m.openChildren));
      if (meta.childElementCount > 0) sheet.append(meta);
      const fields = el2("div", "kb-fields");
      const stateSlot = el2("div", "kb-field");
      const typeSlot = el2("div", "kb-field");
      fields.append(stateSlot, typeSlot);
      sheet.append(fields);
      disposers.push(
        mountSelect(stateSlot, {
          label: "State",
          value: task.state,
          options: STATES.map((s) => {
            const label = m.labels[s];
            return { id: s, label: s, ...label !== void 0 && label !== s ? { hint: label } : {} };
          }),
          disabled: m.busy,
          onChange: (id) => {
            if (id !== task.state) callbacks.onState(id);
          }
        }).dispose
      );
      const types = task.type !== null && !m.types.includes(task.type) ? [...m.types, task.type] : m.types;
      disposers.push(
        mountSelect(typeSlot, {
          label: "Type",
          value: task.type,
          placeholder: "No type",
          options: types.map((t) => ({ id: t, label: t })),
          disabled: m.busy,
          onChange: (id) => {
            if (id !== task.type) callbacks.onType(id);
          }
        }).dispose
      );
      if (m.moves.length > 0) {
        const moveRow = el2("div", "kb-actions kb-actions-start");
        moveRow.append(el2("span", "kb-actions-label", "Move to"));
        for (const { to, label } of m.moves) {
          disposers.push(
            mountButton(moveRow, { label, variant: "outline", size: "xs", disabled: m.busy, onClick: () => callbacks.onMove(to) }).dispose
          );
        }
        sheet.append(moveRow);
      }
      const actions = el2("div", "kb-actions kb-actions-start");
      if (task.state !== "done") {
        disposers.push(
          mountButton(actions, { label: "Close", variant: "secondary", size: "sm", disabled: m.busy, onClick: () => callbacks.onClose(false) }).dispose
        );
        if (m.openChildren > 0) {
          disposers.push(
            mountButton(actions, {
              label: "Close with sub-tasks",
              variant: "destructive",
              size: "sm",
              disabled: m.busy,
              onClick: () => callbacks.onClose(true)
            }).dispose
          );
        }
      }
      const url = task.url;
      if (url !== null) {
        disposers.push(
          mountButton(actions, { label: "Open on GitHub", variant: "ghost", size: "sm", onClick: () => callbacks.onOpenUrl(url) }).dispose
        );
      }
      if (actions.childElementCount > 0) sheet.append(actions);
      const body = el2("pre", "kb-detail-body", task.body.trim() === "" ? "No description." : task.body);
      if (task.body.trim() === "") body.classList.add("is-empty");
      sheet.append(body);
    };
    const onKey = (e) => {
      if (e.key === "Escape" && !e.defaultPrevented) callbacks.onDismiss();
    };
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) callbacks.onDismiss();
    });
    document.addEventListener("keydown", onKey);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    draw2(initial);
    sheet.focus();
    return {
      update: draw2,
      dispose: () => {
        document.removeEventListener("keydown", onKey);
        clear();
        backdrop.remove();
        if (previous?.isConnected) previous.focus();
      }
    };
  };

  // src/panel/drag.ts
  var THRESHOLD = 6;
  var NONE2 = { kind: "none" };
  var end = (press) => ({ press: null, effect: press?.dragging === true ? { kind: "cancel" } : NONE2 });
  var step = (press, input) => {
    switch (input.type) {
      case "down": {
        const stale = end(press);
        if (input.button !== 0 || input.taskId === null) return stale;
        const next = { pointerId: input.pointerId, taskId: input.taskId, from: input.from, x: input.x, y: input.y, dragging: false };
        return { press: next, effect: stale.effect };
      }
      case "move": {
        if (press === null || input.pointerId !== press.pointerId) return { press, effect: NONE2 };
        if ((input.buttons & 1) === 0) return end(press);
        if (press.dragging) return { press, effect: { kind: "follow" } };
        if (Math.hypot(input.x - press.x, input.y - press.y) < THRESHOLD) return { press, effect: NONE2 };
        if (!input.canDrag) return { press: null, effect: NONE2 };
        return { press: { ...press, dragging: true }, effect: { kind: "start" } };
      }
      case "up": {
        if (press === null || input.pointerId !== press.pointerId) return { press, effect: NONE2 };
        if (!press.dragging) return { press: null, effect: { kind: "open", taskId: press.taskId } };
        if (input.to === null) return end(press);
        return { press: null, effect: { kind: "drop", taskId: press.taskId, from: press.from, to: input.to } };
      }
      case "abort": {
        if (press === null) return { press, effect: NONE2 };
        if (input.pointerId !== void 0 && input.pointerId !== press.pointerId) return { press, effect: NONE2 };
        return end(press);
      }
    }
  };

  // src/panel/ui/dnd.ts
  var COLUMNS2 = ["backlog", "ready", "in_progress", "review", "done"];
  var columnOf = (node) => {
    const col = node?.closest(".kb-column") ?? null;
    return col !== null && COLUMNS2.includes(col.dataset.column ?? "") ? col : null;
  };
  var interactive = (target, card) => {
    const hit = target.closest('button, a, input, select, textarea, [role="button"]');
    return hit !== null && hit !== card && card.contains(hit);
  };
  var attachDrag = (container, callbacks) => {
    let press = null;
    let dom = null;
    const setOver = (col) => {
      if (dom === null || dom.over === col) return;
      dom.over?.classList.remove("is-drop-target");
      dom.over = col;
      col?.classList.add("is-drop-target");
    };
    const cleanup = (pointerId, taskId) => {
      const d = dom;
      dom = null;
      if (d !== null) {
        d.over?.classList.remove("is-drop-target");
        d.ghost?.remove();
        d.card.classList.remove("is-dragging");
      }
      if (taskId !== null) container.querySelector(`.kb-card[data-task-id="${CSS.escape(taskId)}"]`)?.classList.remove("is-dragging");
      document.documentElement.classList.remove("kb-dragging");
      if (pointerId !== null && container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    };
    const startGhost = (p, x, y) => {
      if (dom === null) return;
      const ghost = dom.card.cloneNode(true);
      ghost.classList.add("kb-ghost");
      ghost.removeAttribute("tabindex");
      ghost.setAttribute("aria-hidden", "true");
      ghost.style.width = `${dom.width}px`;
      document.body.append(ghost);
      dom.ghost = ghost;
      dom.card.classList.add("is-dragging");
      document.documentElement.classList.add("kb-dragging");
      container.setPointerCapture(p.pointerId);
      follow(x, y);
    };
    const follow = (x, y) => {
      if (dom?.ghost == null) return;
      dom.ghost.style.transform = `translate(${x - dom.dx}px, ${y - dom.dy}px)`;
      setOver(columnOf(document.elementFromPoint(x, y)));
    };
    const feed = (input, at) => {
      const before = press;
      const { press: next, effect } = step(press, input);
      press = next;
      if (before !== null && (next === null || input.type === "down")) cleanup(before.pointerId, before.taskId);
      if (effect.kind === "start" && next !== null && at !== void 0) startGhost(next, at.x, at.y);
      else if (effect.kind === "follow" && at !== void 0) follow(at.x, at.y);
      else if (effect.kind === "open") callbacks.onOpen(effect.taskId);
      else if (effect.kind === "drop") callbacks.onDrop(effect.taskId, effect.from, effect.to);
      return effect;
    };
    const onDown = (e) => {
      const target = e.target instanceof Element ? e.target : null;
      const card = target?.closest(".kb-card") ?? null;
      const col = columnOf(card);
      const ok = card !== null && target !== null && col !== null && card.dataset.taskId !== void 0 && !interactive(target, card);
      const before = press;
      feed({
        type: "down",
        pointerId: e.pointerId,
        button: e.button,
        taskId: ok ? card.dataset.taskId : null,
        from: col?.dataset.column ?? "backlog",
        x: e.clientX,
        y: e.clientY
      });
      if (press !== null && press !== before && ok) {
        const rect = card.getBoundingClientRect();
        dom = { card, ghost: null, dx: e.clientX - rect.left, dy: e.clientY - rect.top, width: rect.width, over: null };
      }
    };
    const onMove = (e) => {
      const effect = feed(
        {
          type: "move",
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          buttons: e.buttons,
          canDrag: press === null || callbacks.canDrag(press.taskId)
        },
        { x: e.clientX, y: e.clientY }
      );
      if (effect.kind === "start" || effect.kind === "follow") e.preventDefault();
    };
    const onUp = (e) => {
      const to = press?.dragging === true ? columnOf(document.elementFromPoint(e.clientX, e.clientY)) : null;
      feed({ type: "up", pointerId: e.pointerId, to: to?.dataset.column ?? null });
    };
    const onPointerAbort = (e) => void feed({ type: "abort", pointerId: e.pointerId });
    const onContextMenu = () => void feed({ type: "abort" });
    const onEscape = (e) => {
      if (e.key === "Escape" && press !== null) feed({ type: "abort" });
    };
    const onKey = (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (!(e.target instanceof HTMLElement) || !e.target.classList.contains("kb-card")) return;
      const id = e.target.dataset.taskId;
      if (id === void 0) return;
      e.preventDefault();
      callbacks.onOpen(id);
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onPointerAbort);
    container.addEventListener("lostpointercapture", onPointerAbort);
    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("keydown", onKey);
    document.addEventListener("keydown", onEscape);
    return () => {
      feed({ type: "abort" });
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onPointerAbort);
      container.removeEventListener("lostpointercapture", onPointerAbort);
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("keydown", onKey);
      document.removeEventListener("keydown", onEscape);
    };
  };

  // src/panel/edit.ts
  var errorText2 = (e) => e instanceof Error ? e.message : String(e);
  var createEditor = (deps) => {
    const moving = /* @__PURE__ */ new Set();
    let detail = null;
    let addDispose = null;
    const find = (id) => deps.tasks().find((t) => t.id === id) ?? null;
    const info = (message) => void deps.host.toast({ kind: "info", message }).catch(() => {
    });
    const fail = (message) => void deps.host.toast({ kind: "error", message }).catch(() => {
    });
    const detailModel = (task) => {
      const tasks = deps.tasks();
      const column = deps.columnOf(task.id) ?? (task.state === "done" ? "done" : task.state === "ready-for-agent" ? "ready" : "backlog");
      const open = openChildren(task, tasks);
      return {
        task,
        column,
        openChildren: open,
        types: taskTypes(tasks),
        labels: deps.labels(),
        moves: COLUMNS.filter(({ id }) => planMove(task, column, id, open).kind !== "none").map(({ id, title }) => ({ to: id, label: title })),
        busy: moving.has(task.id)
      };
    };
    const refreshDetail = () => {
      if (detail === null) return;
      const task = find(detail.id);
      if (task === null) closeDetail();
      else detail.handle.update(detailModel(task));
    };
    const run = async (id, action) => {
      const api = deps.api();
      if (api === null || moving.has(id)) return;
      moving.add(id);
      deps.redraw();
      refreshDetail();
      try {
        await action(api);
      } catch (e) {
        fail(errorText2(e));
      } finally {
        moving.delete(id);
        await deps.reload();
        refreshDetail();
      }
    };
    const close = async (task, askChildren) => {
      let withChildren = false;
      if (askChildren) {
        const n = openChildren(task, deps.tasks());
        const answer = await askChoice(
          `Close \u201C${task.title}\u201D?`,
          `It has ${n} open sub-task${n === 1 ? "" : "s"}.`,
          [
            { id: "all", label: "Close with sub-tasks", variant: "destructive" },
            { id: "one", label: "Close only this task", variant: "secondary" }
          ]
        );
        if (answer === null) return;
        withChildren = answer === "all";
      }
      await run(task.id, (api) => api.close(task.id, withChildren));
    };
    const apply = (task, move2) => {
      switch (move2.kind) {
        case "none":
          info(move2.reason);
          return;
        case "start":
          deps.onStart(task);
          return;
        case "setState":
          void run(task.id, (api) => api.setState(task.id, move2.state));
          return;
        case "close":
          void close(task, move2.askChildren);
          return;
      }
    };
    const move = (id, from, to) => {
      const task = find(id);
      if (task === null || moving.has(id) || from === to) return;
      apply(task, planMove(task, from, to, openChildren(task, deps.tasks())));
    };
    const closeDetail = () => {
      const d = detail;
      detail = null;
      d?.handle.dispose();
    };
    const showDetail = (id) => {
      const task = find(id);
      if (task === null) return;
      closeDetail();
      const handle = openDetail(detailModel(task), {
        onMove: (to) => {
          const t = find(id);
          if (t !== null) move(id, detailModel(t).column, to);
        },
        onState: (state2) => {
          const t = find(id);
          if (t === null) return;
          if (state2 === "done") void close(t, openChildren(t, deps.tasks()) > 0);
          else void run(id, (api) => api.setState(id, state2));
          refreshDetail();
        },
        onType: (type) => void run(id, (api) => api.setType(id, type)),
        onClose: (withChildren) => {
          const t = find(id);
          if (t === null) return;
          if (!withChildren) {
            void run(id, (api) => api.close(id, false));
            return;
          }
          const n = openChildren(t, deps.tasks());
          void askChoice(`Close \u201C${t.title}\u201D and its sub-tasks?`, `This closes the task and its ${n} open sub-task${n === 1 ? "" : "s"}.`, [
            { id: "all", label: "Close with sub-tasks", variant: "destructive" }
          ]).then((answer) => {
            if (answer === "all") void run(id, (api) => api.close(id, true));
          });
        },
        onOpenUrl: (url) => void deps.host.openUrl(url).catch((e) => fail(errorText2(e))),
        onDismiss: closeDetail
      });
      detail = { id, handle };
    };
    const closeAdd = () => {
      addDispose?.();
      addDispose = null;
      deps.board.addForm.replaceChildren();
    };
    const showAdd = () => {
      if (addDispose !== null) {
        deps.board.addForm.querySelector("input")?.focus();
        return;
      }
      const tasks = deps.tasks();
      addDispose = mountAddForm(
        deps.board.addForm,
        {
          types: taskTypes(tasks),
          parents: tasks.filter((t) => t.kind === "parent" && t.state !== "done").map((t) => ({ id: t.id, label: t.title, hint: t.id })),
          tracker: deps.tracker()
        },
        {
          onSubmit: async (input) => {
            const api = deps.api();
            if (api === null) return "No project is open.";
            try {
              const task = await api.create(input);
              closeAdd();
              void deps.host.toast({ kind: "success", message: `Created ${task.id}` }).catch(() => {
              });
              await deps.reload();
              return null;
            } catch (e) {
              return errorText2(e);
            }
          },
          onCancel: closeAdd
        }
      );
    };
    const detachDrag = attachDrag(deps.board.columns, {
      canDrag: (id) => !moving.has(id),
      onDrop: move,
      onOpen: showDetail
    });
    return {
      /** Ids whose write is in flight; the board draws them busy. */
      busy: moving,
      showAdd,
      /** Project switch or the board went away: drop the sheet and the form. */
      reset: () => {
        closeDetail();
        closeAdd();
      },
      /** After a reload from elsewhere (poll, Refresh): keep the open sheet current. */
      refresh: refreshDetail,
      dispose: () => {
        detachDrag();
        closeDetail();
        closeAdd();
      }
    };
  };

  // src/panel/setup.ts
  var TRACKER_NAMES = { local: "local Markdown files", github: "GitHub Issues" };
  var trackerName = (tracker) => TRACKER_NAMES[tracker];
  var defaultChoice = (remote) => remote === null ? "local" : "github";
  var TITLES = {
    UNSUPPORTED: "This project\u2019s tracker is not supported",
    GH_MISSING: "GitHub CLI is not installed",
    GH_OLD: "GitHub CLI is too old",
    GH_AUTH: "GitHub CLI is not logged in",
    NO_SERVICE: "The ICF-kanban service is not allowed or not running"
  };
  var loadNotice = (e) => ({
    tone: e.code === "UNSUPPORTED" ? "warning" : "error",
    title: TITLES[e.code] ?? "Could not load the board",
    body: e.message,
    action: "Retry"
  });
  var setupOutcome = (choice, initError, read) => {
    if ("error" in read) {
      const notice = initError === null ? loadNotice(read.error) : { ...loadNotice(initError), title: "Could not set up the board" };
      return { kind: "notice", notice };
    }
    const tracker = read.config.tracker;
    if (tracker !== choice) {
      return {
        kind: "notice",
        notice: {
          tone: "info",
          title: `This project is already set up for ${trackerName(tracker)}`,
          body: `docs/agents/issue-tracker.md already names ${trackerName(tracker)}, so it was left unchanged. The board uses it.`,
          action: "Open board"
        }
      };
    }
    if (initError !== null) {
      return {
        kind: "notice",
        notice: {
          tone: "warning",
          title: `Set up for ${trackerName(tracker)}, with a problem`,
          body: initError.message,
          action: "Open board"
        }
      };
    }
    return { kind: "board" };
  };

  // src/panel/ui/card.ts
  var typeTone = (type) => type === "bug" ? "error" : type === "enhancement" ? "info" : "neutral";
  var renderCard = (model, busy = false) => {
    const { task } = model;
    const disposers = [];
    const node = document.createElement("article");
    node.className = model.child ? "kb-card is-child" : "kb-card";
    node.dataset.taskId = task.id;
    node.tabIndex = 0;
    node.setAttribute("aria-label", `${task.title} (${task.id})`);
    if (busy) {
      node.classList.add("is-busy");
      node.setAttribute("aria-busy", "true");
    }
    const title = document.createElement("div");
    title.className = "kb-card-title";
    title.textContent = task.title;
    const id = document.createElement("div");
    id.className = "kb-card-id";
    id.textContent = task.id;
    node.append(title, id);
    const badges = document.createElement("div");
    badges.className = "kb-badges";
    const badge = (label, tone2) => {
      disposers.push(mountBadge(badges, { label, tone: tone2 }).dispose);
    };
    if (task.kind === "parent") badge("parent", "primary");
    if (task.type !== null) badge(task.type, typeTone(task.type));
    if (task.state === "ready-for-human") badge("ready-for-human", "warning");
    if (task.state === "wontfix") badge("wontfix", "neutral");
    if (model.blockers.length > 0) badge(`blocked by ${model.blockers.length}`, "error");
    node.append(badges);
    if (model.blockers.length > 0) badges.title = `Waiting for: ${model.blockers.join(", ")}`;
    if (model.progress !== null && model.progress.total > 0) {
      const { done, total } = model.progress;
      const wrap = document.createElement("div");
      wrap.className = "kb-progress";
      const label = document.createElement("div");
      label.className = "kb-progress-label";
      label.textContent = `${done}/${total} sub-tasks done`;
      wrap.append(label);
      disposers.push(
        mountProgress(wrap, { value: Math.round(done / total * 100), tone: done === total ? "success" : "primary" }).dispose
      );
      node.append(wrap);
    }
    return {
      node,
      dispose: () => {
        for (const d of disposers) d();
        node.remove();
      }
    };
  };

  // src/panel/ui/board.ts
  var div = (className) => {
    const node = document.createElement("div");
    node.className = className;
    return node;
  };
  var createBoard = (root, callbacks) => {
    const shell = div("kb");
    const toolbar = div("kb-toolbar");
    const projectSlot = div("kb-project");
    const switchSlot = div("kb-hide");
    const spacer = div("kb-spacer");
    const addSlot = div("kb-add-button");
    const refreshSlot = div("kb-refresh");
    toolbar.append(projectSlot, switchSlot, spacer, addSlot, refreshSlot);
    const addForm = div("kb-add-slot");
    const status = div("kb-status");
    const columns = div("kb-columns");
    shell.append(toolbar, addForm, status, columns);
    root.replaceChildren(shell);
    const project2 = mountSelect(projectSlot, {
      value: null,
      options: [],
      placeholder: "Loading projects\u2026",
      searchable: true,
      searchPlaceholder: "Find a project",
      onChange: (id) => {
        project2.update({ value: id });
        callbacks.onProject(id);
      }
    });
    const hideSwitch = mountSwitch(switchSlot, {
      label: "Hide sub-tasks",
      checked: false,
      onChange: (checked) => {
        hideSwitch.update({ checked });
        callbacks.onHideSubtasks(checked);
      }
    });
    const add = mountButton(addSlot, { label: "Add task", size: "sm", disabled: true, onClick: callbacks.onAdd });
    const refresh = mountButton(refreshSlot, { label: "Refresh", variant: "outline", size: "sm", onClick: callbacks.onRefresh });
    let statusDispose = null;
    let cardDisposers = [];
    return {
      /** The persistent container the cards are drawn in; drag listeners live here. */
      columns,
      /** Where the Add task form is mounted; empty when closed. */
      addForm,
      /** "Add task" works only while a board is shown. */
      setCanAdd: (enabled) => add.update({ disabled: !enabled }),
      setProjects: (options, value) => {
        project2.update({
          options,
          value,
          placeholder: options.length === 0 ? "No projects" : "Choose a project",
          disabled: options.length === 0
        });
      },
      setBusy: (busy) => refresh.update({ loading: busy, disabled: busy }),
      setStatus: (next) => {
        statusDispose?.();
        statusDispose = null;
        status.replaceChildren();
        if (next.kind === "loading") {
          const wrap = div("kb-loading");
          status.append(wrap);
          statusDispose = mountSpinner(wrap, { label: "Loading tasks" }).dispose;
        } else if (next.kind === "banner") {
          statusDispose = mountBanner(status, {
            tone: next.tone,
            title: next.title,
            ...next.body !== void 0 ? { body: next.body } : {}
          }).dispose;
        } else if (next.kind === "empty") {
          statusDispose = mountEmpty(status, { title: next.title, body: next.body }).dispose;
        } else if (next.kind === "custom") {
          statusDispose = next.mount(status);
        }
      },
      /** Draws the columns; null hides them (no project, no tracker, or an error). */
      render: (board2, busy = /* @__PURE__ */ new Set()) => {
        for (const d of cardDisposers) d();
        cardDisposers = [];
        columns.replaceChildren();
        columns.hidden = board2 === null;
        if (board2 === null) return;
        for (const { id, title } of COLUMNS) {
          const cards = board2[id];
          const column = div("kb-column");
          column.dataset.column = id;
          const head = div("kb-column-head");
          const name = document.createElement("span");
          name.textContent = title;
          const count = document.createElement("span");
          count.className = "kb-count";
          count.textContent = String(cards.length);
          head.append(name, count);
          const list = div("kb-cards");
          if (cards.length === 0) {
            const none = div("kb-none");
            none.textContent = "Nothing here";
            list.append(none);
          }
          for (const model of cards) {
            const card = renderCard(model, busy.has(model.task.id));
            list.append(card.node);
            cardDisposers.push(card.dispose);
          }
          column.append(head, list);
          columns.append(column);
        }
      }
    };
  };

  // src/panel/ui/notice.ts
  var mountNotice = (root, model, onAction) => mountBanner(root, {
    tone: model.tone,
    title: model.title,
    body: model.body,
    action: { label: model.action, onClick: onAction }
  }).dispose;

  // src/panel/ui/styles.ts
  var CSS2 = `
html, body { margin: 0; padding: 0; background: var(--oc-bg); color: var(--oc-fg); font-family: var(--oc-font); }
* { box-sizing: border-box; }
.kb { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; min-height: 100vh; }
.kb-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.kb-project { flex: 1 1 12rem; min-width: 10rem; max-width: 22rem; }
.kb-spacer { flex: 1 1 auto; }
.kb-status:empty { display: none; }
.kb-columns { display: flex; gap: 0.75rem; align-items: flex-start; overflow-x: auto; padding-bottom: 0.25rem; }
.kb-column { flex: 1 0 15rem; min-width: 15rem; display: flex; flex-direction: column; gap: 0.5rem;
  background: var(--oc-muted-surface); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); padding: 0.5rem; }
.kb-column-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
  font-weight: 600; font-size: 0.9em; padding: 0.125rem 0.25rem; }
.kb-count { color: var(--oc-muted); font-weight: 500; font-variant-numeric: tabular-nums; }
.kb-cards { display: flex; flex-direction: column; gap: 0.5rem; }
.kb-none { color: var(--oc-muted); font-size: 0.85em; padding: 0.25rem; }
.kb-card { background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border);
  border-radius: var(--oc-radius); padding: 0.5rem 0.625rem; display: flex; flex-direction: column; gap: 0.375rem; }
.kb-card.is-child { margin-left: 0.75rem; }
.kb-card-title { font-weight: 500; overflow-wrap: anywhere; }
.kb-card-id { color: var(--oc-muted); font-family: var(--oc-mono); font-size: 0.8em; overflow-wrap: anywhere; }
.kb-badges { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.kb-badges:empty { display: none; }
.kb-progress { display: flex; flex-direction: column; gap: 0.25rem; }
.kb-progress-label { color: var(--oc-muted); font-size: 0.8em; font-variant-numeric: tabular-nums; }
.kb-wizard { display: flex; flex-direction: column; gap: 0.75rem; max-width: 34rem; margin: 1rem auto; padding: 1rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-wizard-title { margin: 0; font-size: 1.1em; font-weight: 600; }
.kb-wizard-body { margin: 0; color: var(--oc-muted); font-size: 0.9em; }
.kb-wizard-actions { display: flex; justify-content: flex-end; }
.kb-loading { display: flex; justify-content: center; padding: 2rem 0; }
.kb-card { cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.kb-card:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.kb-card.is-dragging { opacity: 0.4; }
.kb-card.is-busy { opacity: 0.6; cursor: progress; }
.kb-ghost { position: fixed; left: 0; top: 0; z-index: 60; pointer-events: none; margin: 0; cursor: grabbing;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); }
:root.kb-dragging, :root.kb-dragging * { cursor: grabbing !important; }
.kb-column.is-drop-target { border-color: var(--oc-primary); box-shadow: inset 0 0 0 1px var(--oc-primary); }
.kb-add-slot:empty { display: none; }
.kb-add { display: flex; flex-direction: column; gap: 0.5rem; max-width: 40rem; padding: 0.75rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-add-error:empty { display: none; }
.kb-fields { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.kb-field { flex: 1 1 10rem; min-width: 0; }
.kb-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5rem; }
.kb-actions-start { justify-content: flex-start; }
.kb-actions-label { color: var(--oc-muted); font-size: 0.85em; }
.kb-backdrop { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / 0.35); display: flex; justify-content: flex-end; }
.kb-sheet { width: min(36rem, 100%); height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem;
  padding: 1rem; background: var(--oc-bg); color: var(--oc-fg); border-left: 1px solid var(--oc-border); outline: none; }
.kb-sheet-head { display: flex; align-items: flex-start; gap: 0.5rem; }
.kb-sheet-titles { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
.kb-sheet-title { margin: 0; font-size: 1.1em; font-weight: 600; overflow-wrap: anywhere; }
.kb-inline-spin { display: inline-flex; align-items: center; }
.kb-meta { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 0; font-size: 0.85em; }
.kb-meta dt { color: var(--oc-muted); }
.kb-meta dd { margin: 0; font-family: var(--oc-mono); overflow-wrap: anywhere; }
.kb-detail-body { margin: 0; padding: 0.75rem; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--oc-mono); font-size: 0.85em;
  background: var(--oc-muted-surface); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-detail-body.is-empty { color: var(--oc-muted); font-family: var(--oc-font); }
.kb-confirm-backdrop { z-index: 70; justify-content: center; align-items: center; padding: 1rem; }
.kb-confirm { width: min(26rem, 100%); display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem;
  background: var(--oc-elevated); color: var(--oc-elevated-fg); border: 1px solid var(--oc-border); border-radius: var(--oc-radius); }
.kb-confirm-title { margin: 0; font-size: 1em; font-weight: 600; overflow-wrap: anywhere; }
.kb-confirm-body { margin: 0; color: var(--oc-muted); font-size: 0.9em; }
:root[data-oc-surface="panel"] .kb-columns { flex-direction: column; align-items: stretch; overflow-x: visible; }
:root[data-oc-surface="panel"] .kb-column { flex: 0 0 auto; min-width: 0; }
`;
  var injected = false;
  var injectStyles = () => {
    if (injected) return;
    injected = true;
    const style = document.createElement("style");
    style.textContent = CSS2;
    document.head.appendChild(style);
  };

  // src/panel/ui/wizard.ts
  var element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  var mountWizard = (root, props) => {
    let choice = props.initial;
    let busy = false;
    const wrap = element("section", "kb-wizard");
    const title = element("h2", "kb-wizard-title", "Set up a task board for this project");
    const body = element(
      "p",
      "kb-wizard-body",
      "Choose where the tasks live. ICF-kanban writes docs/agents/issue-tracker.md in the format the agent skills read."
    );
    const listSlot = element("div", "kb-wizard-choices");
    const actions = element("div", "kb-wizard-actions");
    wrap.append(title, body, listSlot, actions);
    root.append(wrap);
    const list = mountList(listSlot, {
      ariaLabel: "Tracker",
      selectedId: choice,
      items: [
        { id: "local", title: "Local", subtitle: "Markdown files under .scratch/ in this repository" },
        {
          id: "github",
          title: "GitHub",
          subtitle: props.remote === null ? "Issues of the repository\u2019s GitHub remote (none found); needs the gh CLI" : `Issues of ${props.remote}; creates the missing labels, needs the gh CLI`,
          ...props.remote !== null ? { badge: { label: "remote found", tone: "success" } } : {}
        }
      ],
      onSelect: (id) => {
        if (busy || id !== "local" && id !== "github") return;
        choice = id;
        list.update({ selectedId: id });
      }
    });
    const button2 = mountButton(actions, {
      label: "Set up board",
      onClick: () => {
        if (!busy) props.onSetup(choice);
      }
    });
    return {
      setBusy: (next) => {
        busy = next;
        button2.update({ loading: next, disabled: next });
      },
      dispose: () => {
        list.dispose();
        button2.dispose();
        wrap.remove();
      }
    };
  };

  // src/panel/main.ts
  var POLL_MS = 6e4;
  var host = connectHost();
  var state = {
    projects: [],
    projectId: null,
    pinned: false,
    hostDirectory: null,
    sessions: [],
    config: null,
    tasks: null,
    hideSubtasks: false,
    lastLoad: 0,
    view: "none",
    columns: /* @__PURE__ */ new Map()
  };
  var board;
  var editor;
  var unsubscribeSessions = null;
  var generation = 0;
  var project = () => state.projects.find((p) => p.id === state.projectId) ?? null;
  var projectFor = (dir) => {
    if (dir === null) return null;
    let best = null;
    for (const p of state.projects) {
      const inside = dir === p.directory || dir.startsWith(p.directory.endsWith("/") ? p.directory : `${p.directory}/`);
      if (inside && (best === null || p.directory.length > best.directory.length)) best = p;
    }
    return best;
  };
  var draw = () => {
    board.setCanAdd(state.view === "board" && state.config !== null);
    state.columns = /* @__PURE__ */ new Map();
    if (state.config === null || state.tasks === null) {
      board.render(null);
      return;
    }
    const model = groupTasks(state.tasks, state.sessions, /* @__PURE__ */ new Set(), state.hideSubtasks);
    for (const [column, cards] of Object.entries(model)) for (const c of cards) state.columns.set(c.task.id, column);
    board.render(model, editor.busy);
    if (state.tasks.length === 0) {
      board.setStatus({
        kind: "empty",
        title: "No tasks yet",
        body: state.config.tracker === "github" ? "Open issues of this repository show up here. Create one on GitHub or with the task-board CLI, then press Refresh." : "Issues under .scratch/<feature>/issues/ show up here. Create one with the task-board CLI or an agent skill, then press Refresh."
      });
    } else {
      board.setStatus({ kind: "none" });
    }
  };
  var failureOf = (e) => ({
    code: e instanceof ApiError ? e.code : "FAILED",
    message: e instanceof Error ? e.message : String(e)
  });
  var showNotice = (notice) => {
    editor.reset();
    state.config = null;
    state.tasks = null;
    state.view = "notice";
    board.setStatus({ kind: "custom", mount: (slot) => mountNotice(slot, notice, () => void load()) });
    draw();
  };
  var showWizard = (api, remote) => {
    editor.reset();
    state.config = null;
    state.tasks = null;
    state.view = "wizard";
    board.setStatus({
      kind: "custom",
      mount: (slot) => {
        const wizard = mountWizard(slot, {
          remote,
          initial: defaultChoice(remote),
          onSetup: (choice) => {
            wizard.setBusy(true);
            void setup(api, choice);
          }
        });
        return wizard.dispose;
      }
    });
    draw();
  };
  var setup = async (api, choice) => {
    const mine = ++generation;
    board.setBusy(true);
    let initError = null;
    try {
      await api.initConfig(choice);
    } catch (e) {
      initError = failureOf(e);
    }
    if (mine !== generation) return;
    let read;
    try {
      read = await api.readConfig();
    } catch (e) {
      read = { error: failureOf(e) };
    }
    if (mine !== generation) return;
    board.setBusy(false);
    const outcome = setupOutcome(choice, initError, read);
    if (outcome.kind === "board") void load();
    else showNotice(outcome.notice);
  };
  var load = async () => {
    const p = project();
    const mine = ++generation;
    if (p === null) {
      state.config = null;
      state.tasks = null;
      state.view = "none";
      board.setStatus({ kind: "empty", title: "No project", body: "Open or choose a project to see its board." });
      draw();
      return;
    }
    state.lastLoad = Date.now();
    const api = createApi(host, p.directory);
    if (state.tasks === null) board.setStatus({ kind: "loading" });
    board.setBusy(true);
    try {
      const result = await api.readConfig();
      if (mine !== generation) return;
      if ("error" in result) {
        if (result.error.code !== "NOT_CONFIGURED") {
          showNotice(loadNotice(result.error));
          return;
        }
        const remote = await api.detect().catch(() => null);
        if (mine !== generation) return;
        showWizard(api, remote);
        return;
      }
      const tasks = await api.list();
      if (mine !== generation) return;
      state.config = result.config;
      state.tasks = tasks;
      state.view = "board";
      draw();
      editor.refresh();
    } catch (e) {
      if (mine !== generation) return;
      showNotice(loadNotice(failureOf(e)));
    } finally {
      if (mine === generation) board.setBusy(false);
    }
  };
  var backgroundLoad = () => {
    if (state.view !== "wizard") void load();
  };
  var selectProject = async (id) => {
    if (id === state.projectId) return;
    state.projectId = id;
    editor.reset();
    state.sessions = [];
    state.config = null;
    state.tasks = null;
    board.setProjects(projectOptions(), id);
    unsubscribeSessions?.();
    unsubscribeSessions = null;
    void load();
    if (id === null) return;
    try {
      const unsubscribe = await host.onSessions(id, (snapshot) => {
        if (snapshot.projectId !== state.projectId) return;
        state.sessions = snapshot.sessions;
        draw();
      });
      if (state.projectId === id) unsubscribeSessions = unsubscribe;
      else unsubscribe();
    } catch {
    }
  };
  var projectOptions = () => state.projects.map((p) => ({ id: p.id, label: p.name, hint: p.directory }));
  var followHost = () => {
    const current = project();
    if (state.pinned && current !== null) return;
    const next = projectFor(state.hostDirectory) ?? current ?? state.projects[0] ?? null;
    void selectProject(next?.id ?? null);
  };
  var onStart = (_task) => {
    void host.toast({ kind: "info", message: "Starting agents is not wired yet" }).catch(() => {
    });
  };
  var start = (ctx) => {
    injectStyles();
    const root = document.getElementById("root") ?? document.body;
    state.hostDirectory = ctx.directory;
    board = createBoard(root, {
      onProject: (id) => {
        state.pinned = true;
        void selectProject(id);
      },
      onHideSubtasks: (hide) => {
        state.hideSubtasks = hide;
        draw();
      },
      onRefresh: () => void load(),
      onAdd: () => editor.showAdd()
    });
    editor = createEditor({
      host,
      board,
      api: () => {
        const p = project();
        return p === null || state.view !== "board" ? null : createApi(host, p.directory);
      },
      tasks: () => state.tasks ?? [],
      tracker: () => state.config?.tracker ?? "local",
      labels: () => state.config?.labels ?? {},
      columnOf: (id) => state.columns.get(id) ?? null,
      reload: load,
      redraw: draw,
      onStart
    });
    board.setStatus({ kind: "loading" });
    host.onDirectory((dir) => {
      state.hostDirectory = dir;
      if (state.projects.length > 0) followHost();
    });
    host.onProjects((snapshot) => {
      state.projects = snapshot.projects;
      board.setProjects(projectOptions(), state.projectId);
      if (snapshot.state === "loading" && snapshot.projects.length === 0) return;
      if (state.projectId !== null && project() === null) state.pinned = false;
      followHost();
    }).catch((e) => {
      board.setStatus({
        kind: "banner",
        tone: "error",
        title: "Projects are not available",
        body: `${e instanceof Error ? e.message : String(e)}. Allow the \u201Csessions\u201D capability for ICF-kanban in Settings \u2192 Extensions.`
      });
    });
    setInterval(() => {
      if (document.visibilityState === "visible") backgroundLoad();
    }, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && Date.now() - state.lastLoad >= POLL_MS) backgroundLoad();
    });
  };
  var mounted = false;
  host.onReady((ctx) => {
    applyHostReady(ctx, document.documentElement);
    if (mounted) return;
    mounted = true;
    start(ctx);
  });
})();
