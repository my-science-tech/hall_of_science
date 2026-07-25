/* ===========================================================
   gesture.js — shared hand-tracking engine for the Exhibit Hall
   - Tries real webcam pinch-tracking via MediaPipe Hands
   - Falls back automatically to click / tap if the camera or
     the MediaPipe scripts are unavailable
   - Any element with [data-gesture-target] becomes both
     pinch-activatable and click/tap-activatable
   =========================================================== */

const Exhibit = (() => {
  const CAMERA_INIT_TIMEOUT_MS = 6000;
  const PINCH_THRESHOLD = 0.055; // normalized distance, thumb tip <-> index tip

  let mode = "pending"; // 'camera' | 'fallback' | 'pending'
  let statusEl, cursorEl, cameraPreviewEl, videoEl;
  let hoveredTarget = null;
  let isPinching = false;
  let pinchStartTarget = null;

  function log(...args) {
    console.log("[Exhibit]", ...args);
  }

  /* ---------------- shared chrome: status LED, cursor, nav ---------------- */

  function injectChrome({ exhibitHallHref = "index.html" } = {}) {
    // status LED (top bar, right side) — only if a topbar exists
    statusEl = document.getElementById("gesture-status");
    if (!statusEl) {
      statusEl = document.createElement("span");
      statusEl.id = "gesture-status";
      statusEl.className = "gesture-status mode-pending";
      statusEl.innerHTML = `<span class="dot"></span><span class="txt">Checking camera…</span>`;
      const bar = document.querySelector(".topbar");
      if (bar) bar.appendChild(statusEl);
    }

    // gesture cursor dot
    cursorEl = document.createElement("div");
    cursorEl.id = "gesture-cursor";
    document.body.appendChild(cursorEl);

    // camera preview thumbnail
    cameraPreviewEl = document.createElement("div");
    cameraPreviewEl.id = "camera-preview";
    videoEl = document.createElement("video");
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    cameraPreviewEl.appendChild(videoEl);
    document.body.appendChild(cameraPreviewEl);
  }

  function setStatus(newMode, label) {
    mode = newMode;
    if (!statusEl) return;
    statusEl.className = "gesture-status mode-" + newMode;
    statusEl.querySelector(".txt").textContent = label;
  }

  function mountBottomNav({ home = "index.html", playAgain = null, playAgainLabel = "Play again · மீண்டும் விளையாடு" } = {}) {
    const nav = document.createElement("div");
    nav.className = "nav-bottom";

    const homeBtn = document.createElement("a");
    homeBtn.href = home;
    homeBtn.className = "btn btn-ghost";
    homeBtn.setAttribute("data-gesture-target", "");
    homeBtn.innerHTML = "🏠 Home · முகப்பு";
    nav.appendChild(homeBtn);

    if (playAgain) {
      const againBtn = document.createElement("a");
      againBtn.href = playAgain;
      againBtn.className = "btn btn-primary";
      againBtn.setAttribute("data-gesture-target", "");
      againBtn.innerHTML = "🔄 " + playAgainLabel;
      nav.appendChild(againBtn);
    }

    document.body.appendChild(nav);
  }

  /* ---------------- fallback (click / tap) mode ---------------- */

  function enableFallback(reason) {
    if (mode === "fallback") return;
    log("Falling back to click/tap mode:", reason);
    setStatus("fallback", "Click / tap mode");
    cameraPreviewEl && cameraPreviewEl.classList.remove("on");
    cursorEl && (cursorEl.style.display = "none");
    // Native click handlers on [data-gesture-target] elements already work
    // via their own onclick/href — nothing else to wire up.
    wirePointerFallbackEvents();
  }

  // Emits the same 'exhibit:point' event that camera mode emits, so pages
  // like the drawing exhibit can listen once and work in either mode.
  let pointerFallbackWired = false;
  function wirePointerFallbackEvents() {
    if (pointerFallbackWired) return;
    pointerFallbackWired = true;
    let down = false;
    const emit = (x, y, pinching) => {
      window.dispatchEvent(new CustomEvent("exhibit:point", { detail: { x, y, pinching } }));
    };
    window.addEventListener("mousedown", (e) => { down = true; emit(e.clientX, e.clientY, true); });
    window.addEventListener("mousemove", (e) => { emit(e.clientX, e.clientY, down); });
    window.addEventListener("mouseup", (e) => { down = false; emit(e.clientX, e.clientY, false); });
    window.addEventListener("touchstart", (e) => {
      down = true;
      const t = e.touches[0]; if (t) emit(t.clientX, t.clientY, true);
    }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      const t = e.touches[0]; if (t) emit(t.clientX, t.clientY, down);
    }, { passive: true });
    window.addEventListener("touchend", () => { down = false; });
  }

  /* ---------------- camera / MediaPipe mode ---------------- */

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function tryInitCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      enableFallback("getUserMedia unsupported");
      return;
    }

    const timeout = setTimeout(() => enableFallback("camera init timed out"), CAMERA_INIT_TIMEOUT_MS);

    try {
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js");

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 } });
      videoEl.srcObject = stream;
      await videoEl.play();

      const hands = new window.Hands({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 0,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(onResults);

      const camera = new window.Camera(videoEl, {
        onFrame: async () => { await hands.send({ image: videoEl }); },
        width: 480,
        height: 360,
      });
      await camera.start();

      clearTimeout(timeout);
      cameraPreviewEl.classList.add("on");
      cursorEl.style.display = "block";
      setStatus("camera", "Camera ready — pinch to select");
    } catch (err) {
      clearTimeout(timeout);
      enableFallback(err.message || "camera unavailable");
    }
  }

  function onResults(results) {
    if (mode === "fallback") return;
    if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
      hoverClear();
      return;
    }
    const lm = results.multiHandLandmarks[0];
    const thumbTip = lm[4];
    const indexTip = lm[8];

    // mirrored x, since preview + camera feed are mirrored like a mirror
    const x = (1 - indexTip.x) * window.innerWidth;
    const y = indexTip.y * window.innerHeight;

    cursorEl.style.left = x + "px";
    cursorEl.style.top = y + "px";

    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    const dz = (thumbTip.z || 0) - (indexTip.z || 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const pinchingNow = dist < PINCH_THRESHOLD;

    window.dispatchEvent(new CustomEvent("exhibit:point", { detail: { x, y, pinching: pinchingNow } }));

    const elAtPoint = document.elementFromPoint(x, y);
    const target = elAtPoint ? elAtPoint.closest("[data-gesture-target]") : null;
    updateHover(target);

    if (pinchingNow && !isPinching) {
      isPinching = true;
      pinchStartTarget = target;
      cursorEl.classList.add("pinching");
    } else if (!pinchingNow && isPinching) {
      isPinching = false;
      cursorEl.classList.remove("pinching");
      if (target && target === pinchStartTarget) {
        activate(target);
      }
      pinchStartTarget = null;
    }
  }

  function updateHover(target) {
    if (hoveredTarget === target) return;
    if (hoveredTarget) hoveredTarget.classList.remove("gesture-hover");
    hoveredTarget = target;
    if (hoveredTarget) hoveredTarget.classList.add("gesture-hover");
  }

  function hoverClear() {
    if (hoveredTarget) hoveredTarget.classList.remove("gesture-hover");
    hoveredTarget = null;
  }

  function activate(target) {
    // Works for <a>, <button>, or any element with an onclick/data handler
    target.click();
  }

  /* ---------------- visitor counter (index page) ---------------- */

  function bumpVisitorCounter(elId) {
    const el = document.getElementById(elId);
    if (!el) return;
    let n = 0;
    try {
      n = parseInt(localStorage.getItem("psttc_visitors") || "0", 10) || 0;
    } catch (e) { /* private mode etc. */ }
    n += 1;
    try { localStorage.setItem("psttc_visitors", String(n)); } catch (e) {}
    el.textContent = n;
  }

  /* ---------------- public init ---------------- */

  function init(opts = {}) {
    injectChrome(opts);
    if (opts.nav) mountBottomNav(opts.nav);
    tryInitCamera();
  }

  return { init, bumpVisitorCounter, get mode() { return mode; } };
})();
