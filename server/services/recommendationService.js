function forProfile(store, userId, profileId) {
  const data = store.read();
  const profile = data.profiles.find(item => item.id === profileId && item.userId === userId);
  if (!profile) return [];
  const historyIds = new Set(profile.history.map(item => item.videoId));
  const watchedCategories = profile.history
    .map(item => data.videos.find(video => video.id === item.videoId))
    .filter(Boolean)
    .map(video => video.category);
  const preferred = new Set([...(profile.preferences.categories || []), ...watchedCategories, profile.focus].filter(item => item && item !== "All"));
  return data.videos
    .map(video => {
      let score = video.views / 1000;
      if (preferred.has(video.category)) score += 100;
      if (historyIds.has(video.id)) score -= 70;
      if (profile.type === "Kid" && !["Education", "Music", "Shorts"].includes(video.category)) score -= 120;
      if (profile.focus === "Gaming" && video.category === "Gaming") score += 140;
      if (profile.focus === "Study" && video.category === "Education") score += 140;
      return { ...video, streamUrl: video.fileName ? `/api/videos/${video.id}/stream` : null, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}

function aiSummary(store, videoId) {
  const video = store.read().videos.find(item => item.id === videoId);
  if (!video) return { summary: "Pick a video to generate a summary.", chapters: [] };
  const tags = (video.tags || []).slice(0, 3).join(", ");
  return {
    summary: `${video.title} is about ${video.description || tags || video.category}. The useful parts are the setup, the key examples, and the closing takeaways.`,
    chapters: [
      { time: "00:00", title: "Opening context" },
      { time: "02:15", title: "Main idea" },
      { time: "06:40", title: "Highlights and recap" }
    ],
    actions: ["Skip quiet intro", "Jump to highlights", "What did I miss?"]
  };
}

module.exports = { forProfile, aiSummary };
