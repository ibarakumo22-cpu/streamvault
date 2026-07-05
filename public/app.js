const APP_NAME = "I-TECH Video Stream";
const STORAGE_PREFIX = "itechVideo";
const defaultSettings = { theme: "dark", downloadPreference: "720p" };

function readStoredSettings() {
  try {
    return { ...defaultSettings, ...(JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}.settings`) || "{}")) };
  } catch {
    return { ...defaultSettings };
  }
}

function persistSettings(settings) {
  const next = { ...defaultSettings, ...(settings || {}) };
  localStorage.setItem(`${STORAGE_PREFIX}.settings`, JSON.stringify(next));
  return next;
}

function applyTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;
}

const state = {
  token: localStorage.getItem(`${STORAGE_PREFIX}.token`) || localStorage.getItem("streamdeck.token") || "",
  user: null,
  profiles: [],
  activeProfile: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}.profile`) || localStorage.getItem("streamdeck.profile") || "null"),
  settings: readStoredSettings(),
  videos: [],
  categories: [],
  currentVideo: null,
  comments: [],
  notifications: [],
  liveStreams: [],
  view: "home",
  query: "",
  authMode: "login",
  autoplay: true,
  quality: readStoredSettings().downloadPreference || "720p",
  toast: "",
  isAdmin: false
};

const app = document.querySelector("#app");
applyTheme(state.settings.theme);

const offlineStore = {
  async save(video, blob) {
    const key = `${STORAGE_PREFIX}.offline.${state.activeProfile.id}.${video.id}`;
    const dataUrl = await blobToDataUrl(blob);
    localStorage.setItem(key, JSON.stringify({ video, dataUrl, savedAt: Date.now() }));
    return key;
  },
  get(videoId) {
    if (!state.activeProfile) return null;
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.offline.${state.activeProfile.id}.${videoId}`);
    return raw ? JSON.parse(raw) : null;
  },
  remove(videoId) {
    if (!state.activeProfile) return;
    localStorage.removeItem(`${STORAGE_PREFIX}.offline.${state.activeProfile.id}.${videoId}`);
  }
};

const previewStore = {
  key(videoId) {
    return `${STORAGE_PREFIX}.preview.${videoId}`;
  },
  save(videoId, dataUrl) {
    localStorage.setItem(this.key(videoId), dataUrl);
  },
  get(videoId) {
    return localStorage.getItem(this.key(videoId));
  }
};

function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function fileToDataUrl(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

async function extractVideoFrameDataUrl(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;
      video.addEventListener("loadeddata", () => {
        const seekTo = Math.min(0.25, Math.max(0, (video.duration || 1) * 0.02));
        const finalize = () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 1280;
          canvas.height = video.videoHeight || 720;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Canvas unavailable"));
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.88));
        };
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          try {
            finalize();
          } catch (error) {
            reject(error);
          }
        };
        video.addEventListener("seeked", onSeeked);
        try {
          video.currentTime = seekTo;
        } catch (error) {
          video.removeEventListener("seeked", onSeeked);
          finalize();
        }
      }, { once: true });
      video.addEventListener("error", () => reject(new Error("Could not decode video frame")), { once: true });
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function getVideoDuration(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;
      video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
      video.onerror = () => reject(new Error("Could not read video duration"));
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function showToast(message) {
  state.toast = message;
  const toast = document.querySelector("#toast");
  if (toast) toast.textContent = message;
  if (message) {
    setTimeout(() => {
      state.toast = "";
      const activeToast = document.querySelector("#toast");
      if (activeToast) activeToast.textContent = "";
    }, 3200);
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function formatDuration(seconds) {
  seconds = Number(seconds || 0);
  if (!seconds) return "0:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = String(seconds % 60).padStart(2, "0");
  return hrs ? `${hrs}:${String(mins).padStart(2, "0")}:${secs}` : `${mins}:${secs}`;
}

function compactViews(views) {
  views = Number(views || 0);
  if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
  if (views >= 1000) return `${Math.round(views / 1000)}K`;
  return String(views);
}

async function bootstrap() {
  const data = await api(`/api/bootstrap?q=${encodeURIComponent(state.query)}`).catch(() => ({ videos: [], profiles: [], categories: [] }));
  state.user = data.user;
  state.settings = { ...defaultSettings, ...readStoredSettings(), ...(data.user?.settings || {}) };
  state.quality = state.settings.downloadPreference || state.quality || "720p";
  persistSettings(state.settings);
  applyTheme(state.settings.theme);
  state.videos = data.videos || [];
  state.profiles = data.profiles || [];
  state.categories = data.categories || [];
  state.notifications = data.notifications || [];
  state.liveStreams = data.liveStreams || [];
  state.isAdmin = isAdminEmail(state.user?.email);
  if (state.isAdmin) {
    state.view = "admin";
  }
  if (state.activeProfile && !state.profiles.some(profile => profile.id === state.activeProfile.id)) {
    state.activeProfile = null;
    localStorage.removeItem(`${STORAGE_PREFIX}.profile`);
  }
  render();
}

function isAdminEmail(email) {
  const localPart = String(email || "").split("@")[0].toLowerCase();
  return localPart.includes("ivs");
}

function setToken(payload) {
  state.token = payload.token;
  state.user = payload.user;
  state.settings = { ...defaultSettings, ...readStoredSettings(), ...(payload.user?.settings || {}) };
  state.quality = state.settings.downloadPreference || state.quality || "720p";
  persistSettings(state.settings);
  applyTheme(state.settings.theme);
  localStorage.setItem(`${STORAGE_PREFIX}.token`, state.token);
  localStorage.removeItem("streamdeck.token");
}

function logout() {
  localStorage.removeItem(`${STORAGE_PREFIX}.token`);
  localStorage.removeItem(`${STORAGE_PREFIX}.profile`);
  localStorage.removeItem("streamdeck.token");
  localStorage.removeItem("streamdeck.profile");
  state.token = "";
  state.user = null;
  state.activeProfile = null;
  state.isAdmin = false;
  state.view = "home";
  render();
}

function chooseProfile(profile) {
  state.activeProfile = profile;
  localStorage.setItem(`${STORAGE_PREFIX}.profile`, JSON.stringify(profile));
  localStorage.removeItem("streamdeck.profile");
  state.view = "home";
  render();
}

function brand() {
  return `<div class="brand"><span class="brand-mark">▶</span><span>${APP_NAME}</span></div>`;
}

function publicHome() {
  app.innerHTML = `
    <main class="guest-home">
      <header class="guest-nav">
        ${brand()}
        <div class="action-row">
          <button class="ghost" id="guestLogin">Sign in</button>
          <button class="primary" id="guestCreate">Create account</button>
        </div>
      </header>
      <section class="public-links">
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </section>
      <section class="guest-hero">
        <div class="guest-copy">
          <p class="eyebrow">Video streaming, profiles, downloads</p>
          <h1>Watch, upload, save, and personalize every profile.</h1>
          <p class="muted">A modern YouTube-style platform with Netflix-style profiles, offline downloads, recommendations, and creator tools.</p>
          <div class="action-row">
            <button class="primary" id="heroLogin">Sign in</button>
            <button class="ghost" id="heroBrowse">Preview videos</button>
          </div>
        </div>
        <div class="guest-preview">
          ${state.videos.slice(0, 4).map(video => videoCard(video, { disabled: true })).join("")}
        </div>
      </section>
      <section class="public-band" id="features">
        <div><h2>Features</h2><p class="muted">Search, channels, studio, live, offline playback, and AI are all wired into the same experience.</p></div>
        <div><h2 id="pricing">Pricing</h2><p class="muted">Free MVP while we build the platform foundation.</p></div>
        <div><h2 id="about">About</h2><p class="muted">A YouTube-style platform with Netflix profiles and creator workflows.</p></div>
        <div><h2 id="contact">Contact</h2><p class="muted">Ready for your brand, domain, and deployment setup.</p></div>
      </section>
    </main>
  `;
  document.querySelector("#guestLogin").addEventListener("click", () => openAuth("login"));
  document.querySelector("#heroLogin").addEventListener("click", () => openAuth("login"));
  document.querySelector("#guestCreate").addEventListener("click", () => openAuth("register"));
  document.querySelector("#heroBrowse").addEventListener("click", () => document.querySelector(".guest-preview").scrollIntoView({ behavior: "smooth" }));
}

function openAuth(mode) {
  state.authMode = mode;
  state.view = "auth";
  render();
}

function authScreen() {
  const register = state.authMode === "register";
  app.innerHTML = `
    <main class="auth-screen">
      <form class="auth-card stack" id="authForm">
        <button type="button" class="back-button" id="backHome">← Back to home</button>
        ${brand()}
        <div>
          <p class="eyebrow">${register ? "Create your channel" : "Welcome back"}</p>
          <h1>${register ? "Start your video account" : "Sign in to continue"}</h1>
          <p class="muted">Demo account: demo@streamdeck.local / demo1234</p>
        </div>
        ${register ? `<input name="name" placeholder="Full name" autocomplete="name" required>` : ""}
        <input name="email" type="email" placeholder="Email address" value="${register ? "" : "demo@streamdeck.local"}" autocomplete="email" required>
        <input name="password" type="password" placeholder="Password" value="${register ? "" : "demo1234"}" autocomplete="${register ? "new-password" : "current-password"}" required minlength="4">
        ${register ? `<input name="confirmPassword" type="password" placeholder="Confirm password" autocomplete="new-password" required minlength="4">` : ""}
        <button class="primary" name="mode" value="${register ? "register" : "login"}">${register ? "Create account" : "Sign in"}</button>
        <button type="button" class="link-button" id="switchAuth">${register ? "Already have an account? Sign in" : "New here? Create an account"}</button>
        <p id="authError" class="form-error"></p>
      </form>
    </main>
  `;
  document.querySelector("#backHome").addEventListener("click", () => {
    state.view = "home";
    render();
  });
  document.querySelector("#switchAuth").addEventListener("click", () => openAuth(register ? "login" : "register"));
  document.querySelector("#authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (register && payload.password !== payload.confirmPassword) {
      document.querySelector("#authError").textContent = "Passwords do not match.";
      return;
    }
    try {
      setToken(await api(`/api/auth/${register ? "register" : "login"}`, { method: "POST", body: JSON.stringify(payload) }));
      await bootstrap();
    } catch (error) {
      document.querySelector("#authError").textContent = error.message;
    }
  });
}

function profileScreen() {
  const profiles = state.profiles.map(profile => `
    <button class="profile-card" data-profile="${profile.id}">
      <span class="profile-avatar">${escapeHtml(profile.avatar || "User")}</span>
      <strong>${escapeHtml(profile.name)}</strong>
      <span class="muted">${escapeHtml(profile.type)} · ${escapeHtml(profile.focus)}</span>
    </button>
  `).join("");
  app.innerHTML = `
    <main class="profiles-screen">
      <section class="profiles-inner stack">
        <div class="section-header">
          <div>
            ${brand()}
            <h1>Select Profile</h1>
          </div>
          <button class="ghost" id="logout">Logout</button>
        </div>
        <div class="profile-grid">${profiles}</div>
        <form class="form-panel stack" id="profileForm">
          <h2>Add Profile</h2>
          <div class="two-col">
            <input name="name" placeholder="Profile name" required>
            <select name="type">
              <option>Adult</option>
              <option>Kid</option>
              <option>Study</option>
              <option>Gaming</option>
            </select>
          </div>
          <div class="two-col">
            <select name="avatar">
              <option>User</option><option>Kid</option><option>Study</option><option>Gamer</option>
            </select>
            <select name="focus">
              <option>All</option><option>Education</option><option>Gaming</option><option>Tech</option><option>Music</option><option>Study</option>
            </select>
          </div>
          <button class="primary">Add Profile</button>
        </form>
      </section>
    </main>
  `;
  document.querySelector("#logout").addEventListener("click", logout);
  document.querySelectorAll("[data-profile]").forEach(button => {
    button.addEventListener("click", () => chooseProfile(state.profiles.find(profile => profile.id === button.dataset.profile)));
  });
  document.querySelector("#profileForm").addEventListener("submit", async event => {
    event.preventDefault();
    const profile = await api("/api/profiles", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    state.profiles.push(profile);
    chooseProfile(profile);
  });
}

function shell(content) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        ${brand()}
        <form class="search-wrap" id="searchForm">
          <input name="q" value="${escapeHtml(state.query)}" placeholder="Search">
          <button title="Search">⌕</button>
        </form>
        <button class="create-button" data-view="upload">+ Create</button>
        <button class="avatar-button" data-view="account" title="Account">${escapeHtml((state.activeProfile && state.activeProfile.avatar) || "Me")}</button>
      </header>
      <div class="layout">
        <nav class="sidebar">
          ${navButton("home", "Home")}
          ${navButton("discover", "Discover")}
          ${navButton("trending", "Trending")}
          ${navButton("subscriptions", "Subscriptions")}
          ${navButton("channels", "Channels")}
          ${navButton("studio", "Creator Studio")}
          ${navButton("library", "Library")}
          ${navButton("downloads", "Downloads")}
          ${navButton("live", "Live")}
          ${navButton("notifications", `Notifications${state.notifications.filter(note => !note.read).length ? " •" : ""}`)}
          ${navButton("profiles", "Profiles")}
          ${navButton("account", "Account")}
          ${state.isAdmin ? navButton("admin", "Admin") : ""}
          ${state.isAdmin ? navButton("analytics", "Analytics") : ""}
          ${state.isAdmin ? navButton("apis", "Mobile APIs") : ""}
          ${state.isAdmin ? navButton("deployment", "Deployment") : ""}
          ${navButton("settings", "Settings")}
        </nav>
        <main class="content">${content}</main>
      </div>
      <div id="toast" class="toast">${escapeHtml(state.toast)}</div>
    </div>
  `;
  bindShellEvents();
}

function bindShellEvents() {
  document.querySelector("#searchForm").addEventListener("submit", async event => {
    event.preventDefault();
    state.query = new FormData(event.currentTarget).get("q");
    state.view = "discover";
    render();
  });
  document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.view === "profiles") {
      state.activeProfile = null;
      localStorage.removeItem(`${STORAGE_PREFIX}.profile`);
      render();
      return;
    }
    state.view = button.dataset.view;
    render();
  }));
  bindVideoCardActions();
}

function bindVideoCardActions() {
  document.querySelectorAll("[data-open-video]").forEach(button => {
    button.addEventListener("click", () => openVideo(button.dataset.openVideo));
  });
  document.querySelectorAll("[data-card-download]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      const video = state.videos.find(item => item.id === button.dataset.cardDownload);
      if (video) downloadVideo(video);
    });
  });
  document.querySelectorAll("[data-card-subscribe]").forEach(button => {
    button.addEventListener("click", async event => {
      event.stopPropagation();
      await api(`/api/channels/${button.dataset.cardSubscribe}/subscribe`, { method: "POST", body: "{}" });
      showToast("Subscription updated");
    });
  });
  document.querySelectorAll("[data-card-watchlater]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      showToast("Added to watch later");
    });
  });
}

function navButton(view, label) {
  return `<button class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}">${label}</button>`;
}

function videoCard(video, options = {}) {
  const disabled = options.disabled;
  return `
    <article class="video-card">
      <button class="thumb-button" ${disabled ? "" : `data-open-video="${video.id}"`}>
        <span class="thumb" style="background:${video.thumbnail || "#202833"}">
          <span class="play-badge">▶</span>
          <span class="duration">${formatDuration(video.duration)}</span>
          <span class="hover-hint">Preview</span>
        </span>
      </button>
      <div class="video-meta">
        <button class="title-button" ${disabled ? "" : `data-open-video="${video.id}"`}>${escapeHtml(video.title)}</button>
        <div class="muted">${escapeHtml(video.channelName)} · ${compactViews(video.views)} views</div>
        <div class="card-actions">
          <button title="Download" data-card-download="${video.id}">Download</button>
          <button title="Subscribe" data-card-subscribe="${video.channelId}">Subscribe</button>
          <button title="Watch later" data-card-watchlater="${video.id}">Watch later</button>
        </div>
      </div>
    </article>
  `;
}

function escapeXml(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function generatedPoster(video) {
  const title = escapeXml((video.title || "Video").slice(0, 34));
  const channel = escapeXml(video.channelName || "Channel");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="#0e1013"/>
          <stop offset="100%" stop-color="#1d2630"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#g)"/>
      <rect x="74" y="74" width="1132" height="572" rx="30" fill="rgba(0,0,0,0.28)"/>
      <text x="92" y="130" fill="#3ea6ff" font-size="28" font-family="Arial, Helvetica, sans-serif" font-weight="700">I-TECH Video Stream</text>
      <text x="92" y="320" fill="#f4f6f8" font-size="68" font-family="Arial, Helvetica, sans-serif" font-weight="700">${title}</text>
      <text x="92" y="388" fill="#c9d4df" font-size="28" font-family="Arial, Helvetica, sans-serif">${channel}</text>
      <circle cx="1040" cy="360" r="96" fill="rgba(255,255,255,0.12)"/>
      <polygon points="1018,330 1018,390 1072,360" fill="#ffffff"/>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function videoCard(video, options = {}) {
  const disabled = options.disabled;
  const cover = video.coverImage || generatedPoster(video);
  return `
    <article class="video-card">
      <button class="thumb-button" ${disabled ? "" : `data-open-video="${video.id}"`}>
        <span class="thumb">
          <img src="${cover}" alt="" loading="lazy">
          <span class="play-badge">▶</span>
          <span class="duration">${formatDuration(video.duration)}</span>
          <span class="hover-hint">Preview</span>
        </span>
      </button>
      <div class="video-meta">
        <button class="title-button" ${disabled ? "" : `data-open-video="${video.id}"`}>${escapeHtml(video.title)}</button>
        <div class="muted">${escapeHtml(video.channelName)} · ${compactViews(video.views)} views</div>
        <div class="card-actions">
          <button title="Download" data-card-download="${video.id}">Download</button>
          <button title="Subscribe" data-card-subscribe="${video.channelId}">Subscribe</button>
          <button title="Watch later" data-card-watchlater="${video.id}">Watch later</button>
        </div>
      </div>
    </article>
  `;
}

function pickVideoSource(video) {
  return previewStore.get(video.id) || offlineStore.get(video.id)?.dataUrl || video.streamUrl || "";
}

function homeScreen() {
  const historyIds = new Set((state.activeProfile.history || []).map(item => item.videoId));
  const continueWatching = state.videos.filter(video => historyIds.has(video.id));
  const trending = [...state.videos].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8);
  const recommended = state.videos.filter(video => !historyIds.has(video.id)).slice(0, 10);
  const recentlyUploaded = [...state.videos].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 8);
  const liveNow = (state.liveStreams || []).filter(stream => stream.status === "live");
  const aiPicks = recommended.slice(0, 4);
  const categoryChips = state.categories.map(cat => `<button class="chip" data-category="${cat}">${cat}</button>`).join("");
  shell(`
    <section class="section">
      <div class="section-header"><h1 class="section-title">Continue Watching</h1><span class="muted">${escapeHtml(state.activeProfile.name)}</span></div>
      <div class="row">${(continueWatching.length ? continueWatching : state.videos.slice(0, 4)).map(video => videoCard(video)).join("")}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">Trending Now</h2></div>
      <div class="row">${trending.map(video => videoCard(video)).join("")}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">Recommended for You</h2></div>
      <div class="grid">${recommended.map(video => videoCard(video)).join("")}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">Recently Uploaded</h2></div>
      <div class="row">${recentlyUploaded.map(video => videoCard(video)).join("")}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">Live Now</h2><button class="ghost" data-view="live">Go live</button></div>
      <div class="grid">${liveNow.length ? liveNow.map(stream => `
        <article class="channel-card is-live">
          <div>
            <strong>${escapeHtml(stream.title)}</strong>
            <p class="muted">${escapeHtml(stream.channelName)} · ${stream.viewers || 0} watching</p>
          </div>
          <button data-view="live">Watch</button>
        </article>
      `).join("") : "<p class='muted'>No live streams right now.</p>"}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">AI Picks</h2><button class="ghost" data-view="recommendations">See all</button></div>
      <div class="grid">${aiPicks.map(video => videoCard(video)).join("")}</div>
    </section>
    <section class="section">
      <div class="section-header"><h2 class="section-title">Categories</h2></div>
      <div class="chip-row">${categoryChips}</div>
    </section>
  `);
  document.querySelectorAll("[data-category]").forEach(button => button.addEventListener("click", async () => {
    state.query = button.dataset.category;
    await bootstrap();
  }));
}

async function openVideo(videoId) {
  state.currentVideo = state.videos.find(video => video.id === videoId);
  state.view = "watch";
  state.comments = await api(`/api/videos/${videoId}/comments`);
  render();
  api(`/api/profiles/${state.activeProfile.id}/history`, { method: "POST", body: JSON.stringify({ videoId, progress: 1 }) }).catch(() => {});
}

function watchScreen() {
  const video = state.currentVideo || state.videos[0];
  if (!video) return shell("<p>No video selected.</p>");
  const src = pickVideoSource(video);
  const upNext = state.videos.filter(item => item.id !== video.id).slice(0, 8).map(item => videoCard(item)).join("");
  const comments = renderComments(state.comments);
  const likes = video.reactionSummary?.likes ?? (Array.isArray(video.likes) ? video.likes.length : 0);
  const dislikes = video.reactionSummary?.dislikes ?? (Array.isArray(video.dislikes) ? video.dislikes.length : 0);
  const likedBy = video.reactionSummary?.likedBy || [];
  shell(`
    <div class="watch-layout">
      <section class="watch-main stack">
        <div class="player-box">
          ${src ? `
            <video id="player" src="${src}" poster="${escapeXml(video.coverImage || generatedPoster(video))}" ${state.autoplay ? "autoplay" : ""} playsinline preload="metadata" tabindex="0"></video>
            <div class="pro-controls">
              <input id="seekBar" type="range" min="0" max="100" value="0" aria-label="Seek video">
              <div class="control-row">
                <button id="playPause">Play</button>
                <span id="timeReadout">0:00 / 0:00</span>
                <input id="volumeBar" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">
                <select id="speedControl" aria-label="Playback speed">
                  <option value="0.5">0.5x</option>
                  <option value="1" selected>1x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
                <button id="fullscreen">Fullscreen</button>
              </div>
            </div>
          ` : `<div class="placeholder-player">Upload a video file to stream real media.</div>`}
        </div>
        <div class="watch-title-row">
          <h1>${escapeHtml(video.title)}</h1>
          <span class="muted">${compactViews(video.views)} views</span>
        </div>
        <div class="youtube-actions">
          <div class="channel-pill">
            <span class="channel-avatar">${escapeHtml(video.channelName.slice(0, 1))}</span>
            <div><strong>${escapeHtml(video.channelName)}</strong><span class="muted">Creator channel</span></div>
            <button class="subscribe-button" id="subscribe">Subscribe</button>
          </div>
          <div class="action-cluster">
            <button class="pill-button" id="like">Like <span id="likeCount">${likes}</span></button>
            <button class="pill-button" id="dislike">Dislike <span id="dislikeCount">${dislikes}</span></button>
            <button class="pill-button" id="share">Share</button>
            <button class="pill-button" id="download">Download</button>
          </div>
        </div>
        <div class="reaction-summary">
          <div id="reactionSummary" class="muted">${likes} like${likes === 1 ? "" : "s"} · ${dislikes} dislike${dislikes === 1 ? "" : "s"}</div>
          <div id="likedByList" class="liked-by">${likedBy.length ? `<strong>Liked by</strong><div class="liked-by-row">${likedBy.map(person => `<span class="pill-chip">${escapeHtml(person.name)}</span>`).join("")}</div>` : "<span class='muted'>No likes yet.</span>"}</div>
        </div>
        <div class="video-description">
          <div class="action-row">
            <select id="quality" aria-label="Quality selector">
              <option>360p</option><option>720p</option><option>1080p</option><option>4K</option>
            </select>
            <button class="pill-button" id="autoplay">${state.autoplay ? "Autoplay on" : "Autoplay off"}</button>
            <span class="muted">Keyboard: Left/Right seek 5s, Up/Down volume</span>
          </div>
          <p>${escapeHtml(video.description || "No description provided.")}</p>
        </div>
        <div class="comments-panel stack">
          <h2>Comments</h2>
          <form id="commentForm" class="comment-form">
            <textarea name="text" placeholder="Add a comment"></textarea>
            <button class="primary">Comment</button>
          </form>
          <div class="stack">${comments}</div>
        </div>
      </section>
      <aside class="watch-side stack">
        <div class="side-panel stack">
          <div class="section-header"><h2>Up next</h2><button class="pill-button" id="nextAuto">${state.autoplay ? "ON" : "OFF"}</button></div>
          <div class="stack compact-list">${upNext}</div>
        </div>
        <div class="side-panel stack">
          <h2>AI Video Assistant</h2>
          <button id="summary">Summarize video</button>
          <button id="highlights">Jump to highlights</button>
          <button id="recap">What did I miss?</button>
          <div id="aiOutput" class="notice">Smart assistant ready.</div>
        </div>
      </aside>
    </div>
  `);
  bindWatchActions(video);
}

function bindWatchActions(video) {
  const player = document.querySelector("#player");
  const reactionSummary = document.querySelector("#reactionSummary");
  const likedByList = document.querySelector("#likedByList");
  const likeCount = document.querySelector("#likeCount");
  const dislikeCount = document.querySelector("#dislikeCount");
  const refreshReactions = async () => {
    try {
      const reactions = await api(`/api/videos/${video.id}/reactions`);
      video.reactionSummary = reactions;
      video.likes = new Array(reactions.likes).fill(0);
      video.dislikes = new Array(reactions.dislikes).fill(0);
      if (likeCount) likeCount.textContent = String(reactions.likes);
      if (dislikeCount) dislikeCount.textContent = String(reactions.dislikes);
      if (reactionSummary) reactionSummary.textContent = `${reactions.likes} like${reactions.likes === 1 ? "" : "s"} · ${reactions.dislikes} dislike${reactions.dislikes === 1 ? "" : "s"}`;
      if (likedByList) {
        likedByList.innerHTML = reactions.likedBy.length
          ? `<strong>Liked by</strong><div class="liked-by-row">${reactions.likedBy.map(person => `<span class="pill-chip">${escapeHtml(person.name)}</span>`).join("")}</div>`
          : "<span class='muted'>No likes yet.</span>";
      }
    } catch {
      if (reactionSummary) reactionSummary.textContent = "Reactions unavailable right now.";
    }
  };
  if (player) {
    const playPause = document.querySelector("#playPause");
    const seekBar = document.querySelector("#seekBar");
    const volumeBar = document.querySelector("#volumeBar");
    const speedControl = document.querySelector("#speedControl");
    const timeReadout = document.querySelector("#timeReadout");
    const fullscreen = document.querySelector("#fullscreen");
    const updateTime = () => {
      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      seekBar.value = duration ? String((player.currentTime / duration) * 100) : "0";
      timeReadout.textContent = `${formatDuration(Math.floor(player.currentTime))} / ${formatDuration(Math.floor(duration))}`;
      playPause.textContent = player.paused ? "Play" : "Pause";
    };
    playPause.addEventListener("click", () => {
      if (player.paused) player.play();
      else player.pause();
      updateTime();
    });
    seekBar.addEventListener("input", () => {
      if (Number.isFinite(player.duration)) player.currentTime = (Number(seekBar.value) / 100) * player.duration;
    });
    volumeBar.addEventListener("input", () => {
      player.volume = Number(volumeBar.value);
    });
    speedControl.addEventListener("change", () => {
      player.playbackRate = Number(speedControl.value);
      showToast(`Speed set to ${speedControl.value}x`);
    });
    fullscreen.addEventListener("click", () => {
      document.querySelector(".player-box").requestFullscreen?.();
    });
    player.addEventListener("timeupdate", updateTime);
    player.addEventListener("loadedmetadata", updateTime);
    player.addEventListener("play", updateTime);
    player.addEventListener("pause", updateTime);
    player.focus();
    document.onkeydown = event => {
      const tag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.key === "ArrowRight") {
        player.currentTime = Math.min((player.duration || player.currentTime + 5), player.currentTime + 5);
        event.preventDefault();
      }
      if (event.key === "ArrowLeft") {
        player.currentTime = Math.max(0, player.currentTime - 5);
        event.preventDefault();
      }
      if (event.key === "ArrowUp") {
        player.volume = Math.min(1, player.volume + 0.05);
        volumeBar.value = String(player.volume);
        event.preventDefault();
      }
      if (event.key === "ArrowDown") {
        player.volume = Math.max(0, player.volume - 0.05);
        volumeBar.value = String(player.volume);
        event.preventDefault();
      }
      if (event.key.toLowerCase() === "f") {
        document.querySelector(".player-box").requestFullscreen?.();
      }
      if (event.key === " ") {
        if (player.paused) player.play();
        else player.pause();
        event.preventDefault();
      }
    };
  } else {
    document.onkeydown = null;
  }
  refreshReactions();
  document.querySelector("#like").addEventListener("click", async () => {
    const reactions = await api(`/api/videos/${video.id}/like`, { method: "POST", body: JSON.stringify({ type: "like" }) });
    video.reactionSummary = reactions;
    video.likes = new Array(reactions.likes).fill(0);
    video.dislikes = new Array(reactions.dislikes).fill(0);
    if (likeCount) likeCount.textContent = String(reactions.likes);
    if (dislikeCount) dislikeCount.textContent = String(reactions.dislikes);
    await refreshReactions();
    showToast("Liked");
  });
  document.querySelector("#dislike").addEventListener("click", async () => {
    const reactions = await api(`/api/videos/${video.id}/like`, { method: "POST", body: JSON.stringify({ type: "dislike" }) });
    video.reactionSummary = reactions;
    video.likes = new Array(reactions.likes).fill(0);
    video.dislikes = new Array(reactions.dislikes).fill(0);
    if (likeCount) likeCount.textContent = String(reactions.likes);
    if (dislikeCount) dislikeCount.textContent = String(reactions.dislikes);
    await refreshReactions();
    showToast("Feedback saved");
  });
  document.querySelector("#subscribe").addEventListener("click", async () => {
    await api(`/api/channels/${video.channelId}/subscribe`, { method: "POST", body: "{}" });
    showToast("Subscription updated");
  });
  document.querySelector("#share").addEventListener("click", () => {
    navigator.clipboard?.writeText(location.href);
    showToast("Link copied");
  });
  document.querySelector("#autoplay").addEventListener("click", () => { state.autoplay = !state.autoplay; render(); });
  document.querySelector("#nextAuto").addEventListener("click", () => { state.autoplay = !state.autoplay; render(); });
  document.querySelector("#quality").value = state.quality;
  document.querySelector("#quality").addEventListener("change", event => {
    state.quality = event.target.value;
    state.settings = persistSettings({ ...state.settings, downloadPreference: state.quality });
    api("/api/me/settings", { method: "PATCH", body: JSON.stringify(state.settings) }).catch(() => {});
    showToast(`Quality set to ${state.quality}`);
  });
  document.querySelector("#download").addEventListener("click", () => downloadVideo(video));
  document.querySelector("#summary").addEventListener("click", async () => {
    const output = await api(`/api/ai/summary?videoId=${video.id}`);
    document.querySelector("#aiOutput").innerHTML = `${escapeHtml(output.summary)}<br>${output.chapters.map(ch => `${ch.time} ${escapeHtml(ch.title)}`).join("<br>")}`;
  });
  document.querySelector("#highlights").addEventListener("click", () => {
    const activePlayer = document.querySelector("#player");
    if (activePlayer) activePlayer.currentTime = Math.min(120, activePlayer.duration || 120);
  });
  document.querySelector("#recap").addEventListener("click", () => document.querySelector("#aiOutput").textContent = "You are watching the setup, main examples, and final takeaways.");
  document.querySelector("#commentForm").addEventListener("submit", async event => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get("text");
    await api(`/api/videos/${video.id}/comments`, { method: "POST", body: JSON.stringify({ text }) });
    state.comments = await api(`/api/videos/${video.id}/comments`);
    render();
  });
}

function renderComments(comments) {
  const roots = comments.filter(comment => !comment.parentId);
  const replies = comments.filter(comment => comment.parentId);
  return roots.map(comment => `
    <div class="comment"><strong>${escapeHtml(comment.author)}</strong><p>${escapeHtml(comment.text)}</p></div>
    ${replies.filter(reply => reply.parentId === comment.id).map(reply => `<div class="comment reply"><strong>${escapeHtml(reply.author)}</strong><p>${escapeHtml(reply.text)}</p></div>`).join("")}
  `).join("") || "<p class='muted'>No comments yet.</p>";
}

async function downloadVideo(video) {
  const source = pickVideoSource(video);
  if (!source) {
    showToast("This video does not have a downloadable source yet.");
    return;
  }
  try {
    showToast(`Downloading ${state.quality}...`);
    const blob = await fetch(source).then(response => response.blob());
    const localKey = await offlineStore.save(video, blob);
    const profile = await api(`/api/profiles/${state.activeProfile.id}/downloads`, {
      method: "POST",
      body: JSON.stringify({ videoId: video.id, quality: state.quality, folder: "Saved Videos", localKey })
    });
    state.activeProfile = profile;
    localStorage.setItem(`${STORAGE_PREFIX}.profile`, JSON.stringify(profile));
    showToast("Saved for offline playback");
  } catch (error) {
    showToast(error.message || "Download failed");
  }
}

function uploadScreen() {
  shell(`
    <section class="upload-layout">
      <form id="uploadForm" class="form-panel stack">
        <h1>Upload Video</h1>
        <label class="drop-zone">
          <input name="file" type="file" accept="video/*" required>
          <span>Drag a video here or choose a file</span>
        </label>
        <label class="drop-zone">
          <input name="coverFile" type="file" accept="image/*">
          <span>Upload cover photo</span>
        </label>
        <input name="title" placeholder="Title" required>
        <textarea name="description" placeholder="Description"></textarea>
        <input name="tags" placeholder="Tags: tech, education, creator">
        <div class="two-col">
          <select name="category">${["Music", "Education", "Gaming", "Tech", "Shorts", "Documentary"].map(cat => `<option>${cat}</option>`).join("")}</select>
          <select name="visibility"><option>Public</option><option>Private</option><option>Unlisted</option></select>
        </div>
        <div class="chip-row">
          <label><input type="checkbox" name="autoCaptions"> Auto captions</label>
          <label><input type="checkbox" name="smartTags"> Smart tags</label>
          <label><input type="checkbox" name="monetized"> Monetization</label>
          <label><input type="checkbox" name="useVideoBeginning" checked> Use video beginning</label>
        </div>
        <button class="primary">Publish Video</button>
        <p id="uploadStatus" class="muted"></p>
      </form>
    </section>
  `);
  document.querySelector("#uploadForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const coverFile = form.get("coverFile");
    const status = document.querySelector("#uploadStatus");
    status.textContent = "Reading video metadata...";
    const payload = Object.fromEntries(form.entries());
    payload.file = undefined;
    let duration = 0;
    try {
      duration = await getVideoDuration(file);
    } catch {
      duration = 0;
    }
    if (duration > 3600) {
      status.textContent = "Upload rejected: videos longer than 1 hour are not allowed yet.";
      showToast("Upload rejected: videos longer than 1 hour are not allowed yet.");
      return;
    }
    status.textContent = "Uploading...";
    payload.fileData = await fileToDataUrl(file);
    if (coverFile instanceof File && coverFile.size > 0) {
      payload.coverImage = await fileToDataUrl(coverFile);
    } else if (form.has("useVideoBeginning")) {
      try {
        payload.coverImage = await extractVideoFrameDataUrl(file);
      } catch (error) {
        payload.coverImage = generatedPoster({ title: payload.title, channelName: state.user?.name });
      }
    } else {
      payload.coverImage = generatedPoster({ title: payload.title, channelName: state.user?.name });
    }
    payload.duration = Math.round(duration || 0);
    payload.autoCaptions = form.has("autoCaptions");
    payload.smartTags = form.has("smartTags");
    payload.monetized = form.has("monetized");
    try {
      const uploaded = await api("/api/videos", { method: "POST", body: JSON.stringify(payload) });
      previewStore.save(uploaded.id, payload.fileData);
      state.view = "home";
      await bootstrap();
      showToast("Video uploaded successfully");
      alert("Video uploaded successfully");
    } catch (error) {
      status.textContent = error.message || "Upload failed";
      showToast(error.message || "Upload failed");
    }
  });
}

function downloadsScreen() {
  const downloads = state.activeProfile.downloads || [];
  const used = downloads.length;
  const items = downloads.map(item => {
    const video = state.videos.find(entry => entry.id === item.videoId) || { id: item.videoId, title: "Downloaded video", channelName: "" };
    const offline = offlineStore.get(video.id);
    return `
      <div class="download-item">
        <div>
          <strong>${escapeHtml(video.title)}</strong>
          <div class="muted">${escapeHtml(item.quality)} · ${offline ? "Ready offline" : "Needs sync"} · ${escapeHtml(item.folder)}</div>
        </div>
        <div class="action-row">
          <button data-open-video="${video.id}">Watch</button>
          <button data-move-download="${video.id}">Move</button>
          <button data-delete-download="${video.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("") || "<p class='muted'>No downloads yet. Download uploaded videos from the player page or a video card.</p>";
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Downloads Library</h1><span class="muted">${escapeHtml(state.activeProfile.name)}</span></div>
      <div class="download-summary">
        <strong>${used} saved video${used === 1 ? "" : "s"}</strong>
        <span class="muted">Stored locally in this browser per profile. Production target: /Downloads/I-TECH Video Stream/Videos/</span>
      </div>
      ${items}
    </section>
  `);
  document.querySelectorAll("[data-delete-download]").forEach(button => button.addEventListener("click", async () => {
    offlineStore.remove(button.dataset.deleteDownload);
    const profile = await api(`/api/profiles/${state.activeProfile.id}/downloads/${button.dataset.deleteDownload}`, { method: "DELETE" });
    state.activeProfile = profile;
    localStorage.setItem(`${STORAGE_PREFIX}.profile`, JSON.stringify(profile));
    showToast("Download deleted");
    render();
  }));
  document.querySelectorAll("[data-move-download]").forEach(button => button.addEventListener("click", () => {
    showToast("Folder move UI is ready for storage-provider integration");
  }));
}

async function discoverScreen() {
  const result = await api(`/api/discover?q=${encodeURIComponent(state.query)}&category=${encodeURIComponent(state.filterCategory || "")}&sort=${encodeURIComponent(state.sortBy || "relevance")}`);
  const categoryOptions = [`<option value="">All categories</option>`, ...state.categories.map(cat => `<option ${state.filterCategory === cat ? "selected" : ""}>${cat}</option>`)].join("");
  shell(`
    <section class="section stack">
      <div class="section-header">
        <h1 class="section-title">Search & Discovery</h1>
        <span class="muted">${result.videos.length} videos · ${result.channels.length} channels</span>
      </div>
      <div class="discovery-tools">
        <input id="discoverQuery" value="${escapeHtml(state.query)}" placeholder="Search videos, tags, or channels">
        <select id="discoverCategory">${categoryOptions}</select>
        <select id="discoverSort">
          <option value="relevance">Relevance</option>
          <option value="views" ${state.sortBy === "views" ? "selected" : ""}>Most viewed</option>
          <option value="newest" ${state.sortBy === "newest" ? "selected" : ""}>Newest</option>
        </select>
      </div>
      <div class="chip-row">${state.categories.map(cat => `<button class="chip" data-filter-category="${cat}">${cat}</button>`).join("")}</div>
      <h2>Videos</h2>
      <div class="grid">${result.videos.map(video => videoCard(video)).join("") || "<p class='muted'>No videos matched your search.</p>"}</div>
      <h2>Channels</h2>
      <div class="channel-grid">${result.channels.map(channelCard).join("") || "<p class='muted'>No channels matched your search.</p>"}</div>
    </section>
  `);
  document.querySelector("#discoverQuery").addEventListener("input", event => {
    state.query = event.target.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => discoverScreen(), 220);
  });
  document.querySelector("#discoverCategory").addEventListener("change", event => {
    state.filterCategory = event.target.value;
    discoverScreen();
  });
  document.querySelector("#discoverSort").addEventListener("change", event => {
    state.sortBy = event.target.value;
    discoverScreen();
  });
  document.querySelectorAll("[data-filter-category]").forEach(button => button.addEventListener("click", () => {
    state.filterCategory = button.dataset.filterCategory;
    discoverScreen();
  }));
}

function channelCard(channel) {
  return `
    <article class="channel-card">
      <div class="channel-avatar">${escapeHtml(channel.name.slice(0, 1))}</div>
      <div>
        <h3>${escapeHtml(channel.name)}</h3>
        <p class="muted">${channel.subscribers} subscribers · ${channel.videos.length} videos · ${compactViews(channel.views)} views</p>
      </div>
      <button data-open-channel="${channel.id}">Open</button>
      <button data-card-subscribe="${channel.id}">Subscribe</button>
    </article>
  `;
}

async function channelsScreen(channelId = null) {
  if (channelId) {
    const channel = await api(`/api/channels/${channelId}`);
    shell(`
      <section class="section stack">
        <button class="back-button" id="backChannels">← Channels</button>
        <div class="channel-hero">
          <div class="channel-avatar large">${escapeHtml(channel.name.slice(0, 1))}</div>
          <div>
            <h1>${escapeHtml(channel.name)}</h1>
            <p class="muted">${channel.subscribers} subscribers · ${channel.videos.length} videos · ${compactViews(channel.views)} views</p>
          </div>
          <button data-card-subscribe="${channel.id}">Subscribe</button>
        </div>
        <div class="grid">${channel.videos.map(video => videoCard(video)).join("")}</div>
      </section>
    `);
    document.querySelector("#backChannels").addEventListener("click", () => channelsScreen());
    document.querySelectorAll("[data-card-subscribe]").forEach(button => button.addEventListener("click", async () => {
      await api(`/api/channels/${button.dataset.cardSubscribe}/subscribe`, { method: "POST", body: "{}" });
      showToast("Subscription updated");
    }));
    return;
  }
  const channels = await api("/api/channels");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Creator Channels</h1><span class="muted">${channels.length} channels</span></div>
      <div class="channel-grid">${channels.map(channelCard).join("")}</div>
    </section>
  `);
  document.querySelectorAll("[data-open-channel]").forEach(button => button.addEventListener("click", () => channelsScreen(button.dataset.openChannel)));
  document.querySelectorAll("[data-card-subscribe]").forEach(button => button.addEventListener("click", async event => {
    event.stopPropagation();
    await api(`/api/channels/${button.dataset.cardSubscribe}/subscribe`, { method: "POST", body: "{}" });
    showToast("Subscription updated");
  }));
}

async function studioScreen() {
  const videos = await api("/api/studio/videos");
  shell(`
    <section class="section stack">
      <div class="section-header">
        <h1 class="section-title">Creator Studio</h1>
        <button class="primary" data-view="upload">Upload</button>
      </div>
      <div class="studio-stats">
        <div><strong>${videos.length}</strong><span>Videos</span></div>
        <div><strong>${compactViews(videos.reduce((sum, video) => sum + Number(video.views || 0), 0))}</strong><span>Total views</span></div>
        <div><strong>${videos.filter(video => video.visibility !== "Private").length}</strong><span>Public</span></div>
      </div>
      <div class="studio-list">
        ${videos.map(video => `
          <form class="studio-row" data-studio-video="${video.id}">
            <div class="thumb mini" style="background:${video.thumbnail || "#202833"}"></div>
            <input name="title" value="${escapeHtml(video.title)}" placeholder="Title">
            <select name="visibility">
              <option ${video.visibility === "Public" ? "selected" : ""}>Public</option>
              <option ${video.visibility === "Private" ? "selected" : ""}>Private</option>
              <option ${video.visibility === "Unlisted" ? "selected" : ""}>Unlisted</option>
            </select>
            <button>Save</button>
            <button type="button" data-delete-studio="${video.id}">Delete</button>
          </form>
        `).join("") || "<p class='muted'>Upload your first video to manage it here.</p>"}
      </div>
    </section>
  `);
  document.querySelectorAll("[data-studio-video]").forEach(form => form.addEventListener("submit", async event => {
    event.preventDefault();
    await api(`/api/studio/videos/${form.dataset.studioVideo}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
    showToast("Video updated");
  }));
  document.querySelectorAll("[data-delete-studio]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this video from your channel?")) return;
    await api(`/api/studio/videos/${button.dataset.deleteStudio}`, { method: "DELETE" });
    await bootstrap();
    state.view = "studio";
    studioScreen();
  }));
}

async function liveScreen() {
  const streams = await api("/api/live");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Live Broadcasting</h1><span class="muted">${streams.filter(item => item.status === "live").length} live now</span></div>
      <form id="liveForm" class="form-panel stack">
        <h2>Start a live stream</h2>
        <input name="title" placeholder="Live stream title" required>
        <textarea name="description" placeholder="Description"></textarea>
        <button class="primary">Go Live</button>
      </form>
      <div class="channel-grid">
        ${streams.map(stream => `
          <article class="channel-card ${stream.status === "live" ? "is-live" : ""}">
            <div><strong>${escapeHtml(stream.title)}</strong><p class="muted">${escapeHtml(stream.channelName)} · ${stream.status} · ${stream.viewers || 0} watching</p></div>
            ${stream.ownerId === state.user.id && stream.status === "live" ? `<button type="button" data-end-live="${stream.id}">End</button>` : `<button type="button" disabled>${stream.status === "live" ? "Watch live" : "Replay soon"}</button>`}
          </article>
        `).join("") || "<p class='muted'>No live streams yet.</p>"}
      </div>
    </section>
  `);
  document.querySelector("#liveForm").addEventListener("submit", async event => {
    event.preventDefault();
    await api("/api/live", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget).entries())) });
    showToast("You are live");
    await bootstrap();
    liveScreen();
  });
  document.querySelectorAll("[data-end-live]").forEach(button => button.addEventListener("click", async () => {
    await api(`/api/live/${button.dataset.endLive}/end`, { method: "POST", body: "{}" });
    showToast("Live stream ended");
    await bootstrap();
    liveScreen();
  }));
}

async function notificationsScreen() {
  const notes = await api("/api/notifications");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Notifications</h1><button id="markRead">Mark all read</button></div>
      ${notes.map(note => `
        <article class="notification-item ${note.read ? "" : "unread"}">
          <strong>${escapeHtml(note.title)}</strong>
          <p>${escapeHtml(note.body)}</p>
          <span class="muted">${new Date(note.createdAt).toLocaleString()}</span>
        </article>
      `).join("") || "<p class='muted'>No notifications yet.</p>"}
    </section>
  `);
  document.querySelector("#markRead").addEventListener("click", async () => {
    state.notifications = await api("/api/notifications/read", { method: "POST", body: "{}" });
    showToast("Notifications marked read");
    notificationsScreen();
  });
}

async function recommendationsScreen() {
  const recommendations = await api(`/api/profiles/${state.activeProfile.id}/recommendations`);
  simpleListScreen("Personalized Recommendations", recommendations);
}

async function adminScreen() {
  const overview = await api("/api/admin/overview");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Admin Dashboard</h1><span class="muted">Platform monitoring center</span></div>
      <div class="studio-stats">
        <div><strong>${overview.users}</strong><span>Users</span></div>
        <div><strong>${overview.creators}</strong><span>Creators</span></div>
        <div><strong>${overview.videos}</strong><span>Videos</span></div>
        <div><strong>${overview.live}</strong><span>Live streams</span></div>
        <div><strong>${overview.storage}</strong><span>Stored files</span></div>
        <div><strong>${overview.reports}</strong><span>Reports</span></div>
      </div>
    </section>
  `);
}

async function analyticsScreen() {
  const stats = await api("/api/analytics");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Analytics</h1><span class="muted">Creator and platform metrics</span></div>
      <div class="studio-stats">
        <div><strong>${stats.videos}</strong><span>Your videos</span></div>
        <div><strong>${compactViews(stats.views)}</strong><span>Views</span></div>
        <div><strong>${stats.subscribers}</strong><span>Subscribers</span></div>
        <div><strong>${stats.comments}</strong><span>Comments</span></div>
        <div><strong>$${stats.revenue}</strong><span>Estimated revenue</span></div>
      </div>
    </section>
  `);
}

async function apisScreen() {
  const feed = await api("/api/mobile/feed");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Mobile & Smart TV APIs</h1><span class="muted">Reusable backend feed</span></div>
      <div class="grid">${feed.home.slice(0, 6).map(video => videoCard(video)).join("")}</div>
    </section>
  `);
}

async function deploymentScreen() {
  const status = await api("/api/deployment/status");
  shell(`
    <section class="section stack">
      <div class="section-header"><h1 class="section-title">Production Deployment</h1><span class="muted">${status.environment}</span></div>
      <div class="studio-stats">
        <div><strong>${status.api}</strong><span>API</span></div>
        <div><strong>${status.auth}</strong><span>Auth</span></div>
        <div><strong>${status.database}</strong><span>Database</span></div>
        <div><strong>${status.storage}</strong><span>Storage</span></div>
        <div><strong>${status.cdn}</strong><span>CDN</span></div>
        <div><strong>${status.monitoring}</strong><span>Monitoring</span></div>
      </div>
    </section>
  `);
}

function accountScreen() {
  const historyCount = (state.activeProfile.history || []).length;
  const downloadCount = (state.activeProfile.downloads || []).length;
  shell(`
    <section class="account-page stack">
      <div class="account-hero">
        <div class="profile-avatar large">${escapeHtml(state.activeProfile.avatar || "Me")}</div>
        <div>
          <h1>${escapeHtml(state.user.name)}</h1>
          <p class="muted">${escapeHtml(state.user.email)}</p>
          <p>${escapeHtml(state.activeProfile.name)} · ${escapeHtml(state.activeProfile.type)} profile</p>
        </div>
      </div>
      <div class="account-grid">
        <button data-view="studio" class="account-tile"><strong>Your channel</strong><span>Upload and manage videos</span></button>
        <button data-view="library" class="account-tile"><strong>History</strong><span>${historyCount} watched videos</span></button>
        <button data-view="downloads" class="account-tile"><strong>Downloads</strong><span>${downloadCount} offline videos</span></button>
        <button data-view="profiles" class="account-tile"><strong>Switch profile</strong><span>Separate recommendations and downloads</span></button>
      </div>
      <button class="ghost" id="logoutAccount">Sign out</button>
    </section>
  `);
  document.querySelector("#logoutAccount").addEventListener("click", logout);
}

function settingsScreen() {
  const theme = state.settings.theme || "dark";
  const downloadPreference = state.settings.downloadPreference || "720p";
  shell(`
    <section class="section stack settings-layout">
      <div class="section-header">
        <h1 class="section-title">Settings</h1>
        <span class="muted">Appearance and download defaults</span>
      </div>
      <div class="settings-grid">
        <article class="settings-card stack">
          <h2>Appearance</h2>
          <p class="muted">Switch between light and dark mode for the whole platform.</p>
          <div class="toggle-group" id="themeGroup">
            <button type="button" class="${theme === "dark" ? "primary" : "ghost"}" data-theme-choice="dark">Dark</button>
            <button type="button" class="${theme === "light" ? "primary" : "ghost"}" data-theme-choice="light">Light</button>
          </div>
        </article>
        <article class="settings-card stack">
          <h2>Downloads</h2>
          <p class="muted">Choose the default quality used for offline saves.</p>
          <label class="stack">
            <span class="muted">Default download quality</span>
            <select id="downloadPreference">
              ${["360p", "720p", "1080p", "4K"].map(option => `<option ${downloadPreference === option ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </label>
          <div class="notice">Current default: ${escapeHtml(downloadPreference)}</div>
        </article>
      </div>
    </section>
  `);
  document.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", async () => {
    state.settings = persistSettings({ ...state.settings, theme: button.dataset.themeChoice });
    applyTheme(state.settings.theme);
    const updated = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(state.settings) }).catch(() => null);
    if (updated) state.user = updated;
    render();
  }));
  document.querySelector("#downloadPreference").addEventListener("change", async event => {
    state.quality = event.target.value;
    state.settings = persistSettings({ ...state.settings, downloadPreference: state.quality });
    applyTheme(state.settings.theme);
    const updated = await api("/api/me/settings", { method: "PATCH", body: JSON.stringify(state.settings) }).catch(() => null);
    if (updated) state.user = updated;
    showToast(`Default download quality set to ${state.quality}`);
  });
}

function simpleListScreen(title, videos) {
  shell(`
    <section class="section">
      <div class="section-header"><h1 class="section-title">${title}</h1></div>
      <div class="grid">${videos.map(video => videoCard(video)).join("")}</div>
    </section>
  `);
}

function render() {
  document.onkeydown = null;
  if (!state.token || !state.user) {
    if (state.view === "auth") return authScreen();
    return publicHome();
  }
  if (!state.activeProfile && !state.isAdmin) return profileScreen();
  if (state.view === "watch") return watchScreen();
  if (state.view === "discover") return discoverScreen();
  if (state.view === "upload") return uploadScreen();
  if (state.view === "downloads") return downloadsScreen();
  if (state.view === "account") return accountScreen();
  if (state.view === "channels") return channelsScreen();
  if (state.view === "studio") return studioScreen();
  if (state.view === "live") return liveScreen();
  if (state.view === "notifications") return notificationsScreen();
  if (state.view === "recommendations") return recommendationsScreen();
  if (state.view === "admin") return state.isAdmin ? adminScreen() : homeScreen();
  if (state.view === "analytics") return state.isAdmin ? analyticsScreen() : homeScreen();
  if (state.view === "apis") return state.isAdmin ? apisScreen() : homeScreen();
  if (state.view === "deployment") return state.isAdmin ? deploymentScreen() : homeScreen();
  if (state.view === "trending") return simpleListScreen("Trending Now", [...state.videos].sort((a, b) => b.views - a.views));
  if (state.view === "subscriptions") return simpleListScreen("Subscriptions", state.videos.filter(video => state.user.subscriptions?.includes(video.channelId)));
  if (state.view === "library") return simpleListScreen("Library", state.videos.filter(video => (state.activeProfile.history || []).some(item => item.videoId === video.id)));
  if (state.view === "settings") return settingsScreen();
  return homeScreen();
}

bootstrap();
