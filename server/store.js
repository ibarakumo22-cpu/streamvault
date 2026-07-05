const fs = require("fs");
const path = require("path");

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function seed() {
  const now = new Date().toISOString();
  const userId = "user_demo";
  const profileId = "profile_demo";
  const videoIds = ["vid_music", "vid_edu", "vid_game", "vid_tech", "vid_short", "vid_doc"];
  const videos = [
    ["vid_music", "Neon Studio Session", "Music", ["music", "live", "beats"], "A late-night performance with crisp synths and a calm visual pulse.", 820],
    ["vid_edu", "Data Structures in 20 Minutes", "Education", ["education", "coding", "study"], "A focused walkthrough of arrays, maps, trees, and graph intuition.", 1200],
    ["vid_game", "Boss Fight Breakdown", "Gaming", ["gaming", "walkthrough", "highlights"], "Fast cuts, strategy notes, and the clutch moments that decide the run.", 640],
    ["vid_tech", "Building a Home Media Server", "Tech", ["tech", "servers", "storage"], "A practical tour through storage, transcoding, and network setup.", 970],
    ["vid_short", "60 Second Camera Trick", "Shorts", ["shorts", "camera", "creator"], "A quick creator tip for making handheld shots feel cinematic.", 60],
    ["vid_doc", "How Cities Sleep", "Documentary", ["documentary", "city", "night"], "A quiet mini documentary about logistics, food, and transit after dark.", 1430]
  ].map(([videoId, title, category, tags, description, duration], index) => ({
    id: videoId,
    title,
    description,
    category,
    tags,
    duration,
    views: 12000 + index * 7350,
    channelId: index % 2 ? "chan_focus" : "chan_stream",
    channelName: index % 2 ? "Focus Lab" : "StreamDeck Originals",
    ownerId: userId,
    thumbnail: `linear-gradient(135deg, hsl(${210 + index * 24} 74% 42%), hsl(${22 + index * 38} 82% 54%))`,
    fileName: null,
    createdAt: now,
    likes: [],
    dislikes: []
  }));

  return {
    users: [{
      id: userId,
      name: "Demo Creator",
      email: "demo@streamdeck.local",
      passwordHash: "demo",
      createdAt: now,
      subscriptions: ["chan_stream"],
      settings: { theme: "dark", downloadPreference: "720p" }
    }],
    profiles: [{
      id: profileId,
      userId,
      name: "Main Profile",
      type: "Adult",
      avatar: "👤",
      focus: "All",
      history: videoIds.slice(0, 2).map(videoId => ({ videoId, watchedAt: now, progress: 35 })),
      downloads: [],
      preferences: { categories: ["Tech", "Education", "Music"] }
    }],
    videos,
    comments: [
      { id: "com_1", videoId: "vid_edu", userId, author: "Demo Creator", text: "The tree section finally clicked for me.", parentId: null, createdAt: now },
      { id: "com_2", videoId: "vid_edu", userId, author: "Demo Creator", text: "Same. The visual examples help.", parentId: "com_1", createdAt: now }
    ],
    notifications: []
  };
}

function initStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "db.json");
  if (!fs.existsSync(dbPath)) {
    fs.writeFileSync(dbPath, JSON.stringify(seed(), null, 2));
  }

  function read() {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  }

  function write(data) {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    return data;
  }

  function update(mutator) {
    const data = read();
    const result = mutator(data);
    write(data);
    return result;
  }

  return { id, read, write, update };
}

module.exports = { initStore };
