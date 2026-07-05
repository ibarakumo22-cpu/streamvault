function ensureCollections(data) {
  data.notifications = data.notifications || [];
  data.liveStreams = data.liveStreams || [];
}

function publicVideo(video) {
  return { ...video, streamUrl: video.fileName ? `/api/videos/${video.id}/stream` : null };
}

function channels(store) {
  const data = store.read();
  const grouped = new Map();
  data.videos.forEach(video => {
    if (!grouped.has(video.channelId)) {
      grouped.set(video.channelId, {
        id: video.channelId,
        name: video.channelName,
        ownerId: video.ownerId,
        subscribers: data.users.filter(user => (user.subscriptions || []).includes(video.channelId)).length,
        videos: [],
        views: 0
      });
    }
    const channel = grouped.get(video.channelId);
    channel.videos.push(publicVideo(video));
    channel.views += Number(video.views || 0);
  });
  return [...grouped.values()].sort((a, b) => b.subscribers - a.subscribers || b.views - a.views);
}

function channel(store, channelId) {
  return channels(store).find(item => item.id === channelId) || null;
}

function creatorVideos(store, userId) {
  return store.read().videos.filter(video => video.ownerId === userId).map(publicVideo);
}

function updateVideo(store, userId, videoId, input) {
  return store.update(data => {
    const video = data.videos.find(item => item.id === videoId && item.ownerId === userId);
    if (!video) {
      const error = new Error("Video not found");
      error.statusCode = 404;
      throw error;
    }
    ["title", "description", "category", "visibility"].forEach(field => {
      if (input[field] != null) video[field] = String(input[field]).trim();
    });
    if (input.tags != null) video.tags = String(input.tags).split(",").map(tag => tag.trim()).filter(Boolean);
    return publicVideo(video);
  });
}

function deleteVideo(store, userId, videoId) {
  return store.update(data => {
    const index = data.videos.findIndex(video => video.id === videoId && video.ownerId === userId);
    if (index === -1) {
      const error = new Error("Video not found");
      error.statusCode = 404;
      throw error;
    }
    const [removed] = data.videos.splice(index, 1);
    data.comments = data.comments.filter(comment => comment.videoId !== videoId);
    data.notifications.push({
      id: store.id("note"),
      userId,
      title: "Video removed",
      body: `${removed.title} was removed from your channel.`,
      read: false,
      createdAt: new Date().toISOString()
    });
    return { ok: true };
  });
}

function notifications(store, userId) {
  const data = store.read();
  ensureCollections(data);
  return data.notifications
    .filter(note => note.userId === userId || note.userId === "all")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function markNotificationsRead(store, userId) {
  return store.update(data => {
    ensureCollections(data);
    data.notifications.forEach(note => {
      if (note.userId === userId || note.userId === "all") note.read = true;
    });
    return notifications({ read: () => data }, userId);
  });
}

function liveStreams(store) {
  const data = store.read();
  ensureCollections(data);
  return data.liveStreams.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function startLive(store, user, input) {
  return store.update(data => {
    ensureCollections(data);
    const live = {
      id: store.id("live"),
      title: String(input.title || "Untitled live stream").trim(),
      description: String(input.description || "").trim(),
      channelId: `chan_${user.id}`,
      channelName: user.name,
      ownerId: user.id,
      status: "live",
      viewers: 1,
      startedAt: new Date().toISOString()
    };
    data.liveStreams.unshift(live);
    data.notifications.push({
      id: store.id("note"),
      userId: "all",
      title: "Live now",
      body: `${user.name} started: ${live.title}`,
      read: false,
      createdAt: new Date().toISOString()
    });
    return live;
  });
}

function endLive(store, userId, liveId) {
  return store.update(data => {
    ensureCollections(data);
    const live = data.liveStreams.find(item => item.id === liveId && item.ownerId === userId);
    if (!live) {
      const error = new Error("Live stream not found");
      error.statusCode = 404;
      throw error;
    }
    live.status = "ended";
    live.endedAt = new Date().toISOString();
    return live;
  });
}

function discover(store, searchParams) {
  const query = String(searchParams.get("q") || "").toLowerCase();
  const category = String(searchParams.get("category") || "");
  const sort = String(searchParams.get("sort") || "relevance");
  const data = store.read();
  let videos = data.videos.filter(video => {
    const haystack = [video.title, video.description, video.channelName, ...(Array.isArray(video.tags) ? video.tags : String(video.tags || "").split(/\s+/))].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) && (!category || video.category === category);
  });
  if (sort === "views") videos.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
  if (sort === "newest") videos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { videos: videos.map(publicVideo), channels: channels(store).filter(item => !query || item.name.toLowerCase().includes(query)) };
}

function adminOverview(store) {
  const data = store.read();
  ensureCollections(data);
  return {
    users: data.users.length,
    creators: [...new Set(data.videos.map(video => video.ownerId))].length,
    videos: data.videos.length,
    live: data.liveStreams.filter(item => item.status === "live").length,
    reports: 0,
    storage: data.videos.filter(video => video.fileName).length
  };
}

function analytics(store, userId) {
  const data = store.read();
  const myVideos = data.videos.filter(video => video.ownerId === userId);
  const views = myVideos.reduce((sum, video) => sum + Number(video.views || 0), 0);
  return {
    videos: myVideos.length,
    views,
    subscribers: channels(store).filter(channel => channel.ownerId === userId).reduce((sum, channel) => sum + channel.subscribers, 0),
    comments: data.comments.filter(comment => myVideos.some(video => video.id === comment.videoId)).length,
    revenue: Math.round(views * 0.002)
  };
}

function mobileFeed(store) {
  const data = store.read();
  return {
    home: data.videos.slice(0, 12).map(publicVideo),
    trending: [...data.videos].sort((a, b) => Number(b.views || 0) - Number(a.views || 0)).slice(0, 12).map(publicVideo),
    live: liveStreams(store)
  };
}

function deploymentStatus(store) {
  const data = store.read();
  ensureCollections(data);
  return {
    environment: "development",
    auth: "JWT",
    api: "healthy",
    database: "json-store",
    storage: "local-files",
    cdn: "not-configured",
    monitoring: "basic",
    uptime: process.uptime ? Math.round(process.uptime()) : 0
  };
}

module.exports = {
  channels,
  channel,
  creatorVideos,
  updateVideo,
  deleteVideo,
  notifications,
  markNotificationsRead,
  liveStreams,
  startLive,
  endLive,
  discover,
  adminOverview,
  analytics,
  mobileFeed,
  deploymentStatus
};
