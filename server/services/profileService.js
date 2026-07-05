function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function assertProfile(data, userId, profileId) {
  const profile = data.profiles.find(item => item.id === profileId && item.userId === userId);
  if (!profile) fail("Profile not found", 404);
  return profile;
}

function listProfiles(store, userId) {
  return store.read().profiles.filter(profile => profile.userId === userId);
}

function createProfile(store, userId, input) {
  const name = String(input.name || "").trim();
  if (!name) fail("Profile name is required");
  return store.update(data => {
    const profile = {
      id: store.id("profile"),
      userId,
      name,
      type: input.type || "Adult",
      avatar: input.avatar || "👤",
      focus: input.focus || "All",
      history: [],
      downloads: [],
      preferences: { categories: input.categories || [] }
    };
    data.profiles.push(profile);
    return profile;
  });
}

function addHistory(store, userId, profileId, input) {
  return store.update(data => {
    const profile = assertProfile(data, userId, profileId);
    const videoId = input.videoId;
    profile.history = profile.history.filter(item => item.videoId !== videoId);
    profile.history.unshift({
      videoId,
      progress: Number(input.progress || 0),
      watchedAt: new Date().toISOString()
    });
    profile.history = profile.history.slice(0, 80);
    return profile;
  });
}

function addDownload(store, userId, profileId, input) {
  return store.update(data => {
    const profile = assertProfile(data, userId, profileId);
    const video = data.videos.find(item => item.id === input.videoId);
    if (!video) fail("Video not found", 404);
    profile.downloads = profile.downloads.filter(item => item.videoId !== video.id);
    profile.downloads.unshift({
      videoId: video.id,
      quality: input.quality || "720p",
      folder: input.folder || "Saved Videos",
      localKey: input.localKey || "",
      downloadedAt: new Date().toISOString()
    });
    return profile;
  });
}

function removeDownload(store, userId, profileId, videoId) {
  return store.update(data => {
    const profile = assertProfile(data, userId, profileId);
    profile.downloads = profile.downloads.filter(item => item.videoId !== videoId);
    return profile;
  });
}

module.exports = { listProfiles, createProfile, addHistory, addDownload, removeDownload };
