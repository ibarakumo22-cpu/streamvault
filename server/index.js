const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { initStore } = require("./store");
const authService = require("./services/authService");
const profileService = require("./services/profileService");
const videoService = require("./services/videoService");
const socialService = require("./services/socialService");
const recommendationService = require("./services/recommendationService");
const platformService = require("./services/platformService");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const dataDir = path.join(rootDir, "data");
const videoDir = path.join(dataDir, "videos");
const store = initStore(dataDir);
const port = Number(process.env.PORT || 4173);

fs.mkdirSync(videoDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg"
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    ...headers
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  send(res, status, body, { "Content-Type": "application/json; charset=utf-8" });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 120 * 1024 * 1024) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return authService.verifyToken(token, store);
}

function requireUser(req, res) {
  const user = getUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Authentication required" });
    return null;
  }
  return user;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return send(res, 403, "Forbidden");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Not found");
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function streamVideo(req, res, videoId) {
  const video = videoService.findVideo(store, videoId);
  if (!video || !video.fileName) return send(res, 404, "Video not found");
  const filePath = path.join(videoDir, video.fileName);
  if (!fs.existsSync(filePath)) return send(res, 404, "Video file not found");

  const stat = fs.statSync(filePath);
  const range = req.headers.range;
  const contentType = video.mimeType || mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  if (!range) {
    res.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes"
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const [startText, endText] = range.replace(/bytes=/, "").split("-");
  const start = parseInt(startText, 10);
  const end = endText ? parseInt(endText, 10) : stat.size - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= stat.size) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1,
    "Content-Type": contentType
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

async function routeApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const pathname = url.pathname;

  try {
    if (method === "POST" && pathname === "/api/auth/register") {
      return sendJson(res, 201, authService.register(store, await readJson(req)));
    }
    if (method === "POST" && pathname === "/api/auth/login") {
      return sendJson(res, 200, authService.login(store, await readJson(req)));
    }

    if (method === "GET" && pathname === "/api/bootstrap") {
      const user = getUser(req);
      return sendJson(res, 200, {
        user,
        videos: videoService.listVideos(store, url.searchParams),
        profiles: user ? profileService.listProfiles(store, user.id) : [],
        categories: videoService.categories(store),
        notifications: user ? platformService.notifications(store, user.id) : [],
        liveStreams: platformService.liveStreams(store)
      });
    }

    if (method === "GET" && pathname.startsWith("/api/videos/") && pathname.endsWith("/stream")) {
      return streamVideo(req, res, pathname.split("/")[3]);
    }

    if (method === "GET" && pathname === "/api/discover") {
      return sendJson(res, 200, platformService.discover(store, url.searchParams));
    }
    if (method === "GET" && pathname === "/api/channels") {
      return sendJson(res, 200, platformService.channels(store));
    }
    if (method === "GET" && pathname.match(/^\/api\/channels\/[^/]+$/)) {
      const channel = platformService.channel(store, pathname.split("/")[3]);
      return channel ? sendJson(res, 200, channel) : sendJson(res, 404, { error: "Channel not found" });
    }
    if (method === "GET" && pathname === "/api/live") {
      return sendJson(res, 200, platformService.liveStreams(store));
    }

    const user = requireUser(req, res);
    if (!user) return;

    if (method === "GET" && pathname === "/api/profiles") {
      return sendJson(res, 200, profileService.listProfiles(store, user.id));
    }
    if (method === "POST" && pathname === "/api/profiles") {
      return sendJson(res, 201, profileService.createProfile(store, user.id, await readJson(req)));
    }
    if (method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/history$/)) {
      return sendJson(res, 200, profileService.addHistory(store, user.id, pathname.split("/")[3], await readJson(req)));
    }
    if (method === "POST" && pathname.match(/^\/api\/profiles\/[^/]+\/downloads$/)) {
      return sendJson(res, 200, profileService.addDownload(store, user.id, pathname.split("/")[3], await readJson(req)));
    }
    if (method === "DELETE" && pathname.match(/^\/api\/profiles\/[^/]+\/downloads\/[^/]+$/)) {
      const [, , , profileId, , videoId] = pathname.split("/");
      return sendJson(res, 200, profileService.removeDownload(store, user.id, profileId, videoId));
    }
    if (method === "GET" && pathname.match(/^\/api\/profiles\/[^/]+\/recommendations$/)) {
      return sendJson(res, 200, recommendationService.forProfile(store, user.id, pathname.split("/")[3]));
    }

    if (method === "GET" && pathname === "/api/videos") {
      return sendJson(res, 200, videoService.listVideos(store, url.searchParams));
    }
    if (method === "POST" && pathname === "/api/videos") {
      return sendJson(res, 201, videoService.uploadVideo(store, videoDir, user, await readJson(req)));
    }
    if (method === "GET" && pathname === "/api/studio/videos") {
      return sendJson(res, 200, platformService.creatorVideos(store, user.id));
    }
    if (method === "PATCH" && pathname.match(/^\/api\/studio\/videos\/[^/]+$/)) {
      return sendJson(res, 200, platformService.updateVideo(store, user.id, pathname.split("/")[4], await readJson(req)));
    }
    if (method === "DELETE" && pathname.match(/^\/api\/studio\/videos\/[^/]+$/)) {
      return sendJson(res, 200, platformService.deleteVideo(store, user.id, pathname.split("/")[4]));
    }
    if (method === "POST" && pathname.match(/^\/api\/videos\/[^/]+\/like$/)) {
      return sendJson(res, 200, socialService.react(store, user.id, pathname.split("/")[3], await readJson(req)));
    }
    if (method === "GET" && pathname.match(/^\/api\/videos\/[^/]+\/reactions$/)) {
      return sendJson(res, 200, socialService.reactions(store, pathname.split("/")[3]));
    }
    if (method === "GET" && pathname.match(/^\/api\/videos\/[^/]+\/comments$/)) {
      return sendJson(res, 200, socialService.comments(store, pathname.split("/")[3]));
    }
    if (method === "POST" && pathname.match(/^\/api\/videos\/[^/]+\/comments$/)) {
      return sendJson(res, 201, socialService.addComment(store, user.id, pathname.split("/")[3], await readJson(req)));
    }
    if (method === "POST" && pathname.match(/^\/api\/channels\/[^/]+\/subscribe$/)) {
      return sendJson(res, 200, socialService.toggleSubscription(store, user.id, pathname.split("/")[3]));
    }
    if (method === "GET" && pathname === "/api/notifications") {
      return sendJson(res, 200, platformService.notifications(store, user.id));
    }
    if (method === "POST" && pathname === "/api/notifications/read") {
      return sendJson(res, 200, platformService.markNotificationsRead(store, user.id));
    }
    if (method === "GET" && pathname === "/api/admin/overview") {
      return sendJson(res, 200, platformService.adminOverview(store));
    }
    if (method === "GET" && pathname === "/api/analytics") {
      return sendJson(res, 200, platformService.analytics(store, user.id));
    }
    if (method === "GET" && pathname === "/api/mobile/feed") {
      return sendJson(res, 200, platformService.mobileFeed(store));
    }
    if (method === "GET" && pathname === "/api/deployment/status") {
      return sendJson(res, 200, platformService.deploymentStatus(store));
    }
    if (method === "POST" && pathname === "/api/live") {
      return sendJson(res, 201, platformService.startLive(store, user, await readJson(req)));
    }
    if (method === "POST" && pathname.match(/^\/api\/live\/[^/]+\/end$/)) {
      return sendJson(res, 200, platformService.endLive(store, user.id, pathname.split("/")[3]));
    }
    if (method === "GET" && pathname === "/api/ai/summary") {
      return sendJson(res, 200, recommendationService.aiSummary(store, url.searchParams.get("videoId")));
    }
    if (method === "PATCH" && pathname === "/api/me/settings") {
      return sendJson(res, 200, authService.updateSettings(store, user.id, await readJson(req)));
    }

    sendJson(res, 404, { error: "API route not found" });
  } catch (error) {
    const status = error.statusCode || 400;
    sendJson(res, status, { error: error.message || "Request failed" });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return routeApi(req, res);
  return serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`StreamDeck MVP running at http://localhost:${port}`);
});
