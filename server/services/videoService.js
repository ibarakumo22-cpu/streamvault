const fs = require("fs");
const path = require("path");

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function publicVideo(video) {
  return {
    ...video,
    streamUrl: video.fileName ? `/api/videos/${video.id}/stream` : null
  };
}

function listVideos(store, searchParams = new URLSearchParams()) {
  const data = store.read();
  const query = String(searchParams.get("q") || "").toLowerCase();
  const category = String(searchParams.get("category") || "");
  return data.videos
    .filter(video => {
      const matchesQuery = !query || [video.title, video.description, video.channelName, ...(video.tags || [])].join(" ").toLowerCase().includes(query);
      const matchesCategory = !category || video.category === category;
      return matchesQuery && matchesCategory;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicVideo);
}

function categories(store) {
  return [...new Set(store.read().videos.map(video => video.category))].sort();
}

function findVideo(store, videoId) {
  return store.read().videos.find(video => video.id === videoId);
}

function uploadVideo(store, videoDir, user, input) {
  const title = String(input.title || "").trim();
  const dataUrl = String(input.fileData || "");
  if (!title || !dataUrl.startsWith("data:video/")) fail("A title and video file are required");
  const duration = Number(input.duration || 0);
  if (duration > 3600) fail("Videos longer than 1 hour are not allowed yet");

  const match = dataUrl.match(/^data:(video\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) fail("Invalid video payload");
  const mime = match[1];
  const ext = mime.includes("webm") ? ".webm" : mime.includes("ogg") ? ".ogg" : ".mp4";
  const fileName = `${store.id("upload")}${ext}`;
  fs.writeFileSync(path.join(videoDir, fileName), Buffer.from(match[2], "base64"));

  return store.update(data => {
    const video = {
      id: store.id("vid"),
      title,
      description: String(input.description || "").trim(),
      category: input.category || "Tech",
      tags: String(input.tags || "").split(",").map(tag => tag.trim()).filter(Boolean),
      duration,
      views: 0,
      channelId: `chan_${user.id}`,
      channelName: input.channelName || user.name,
      ownerId: user.id,
      coverImage: input.coverImage || input.thumbnail || null,
      fileName,
      mimeType: mime,
      createdAt: new Date().toISOString(),
      visibility: input.visibility || "Public",
      autoCaptions: Boolean(input.autoCaptions),
      smartTags: Boolean(input.smartTags),
      monetized: Boolean(input.monetized),
      likes: [],
      dislikes: []
    };
    data.videos.unshift(video);
    return publicVideo(video);
  });
}

module.exports = { listVideos, categories, findVideo, uploadVideo };
