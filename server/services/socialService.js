function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function react(store, userId, videoId, input) {
  return store.update(data => {
    const video = data.videos.find(item => item.id === videoId);
    if (!video) fail("Video not found", 404);
    video.likes = video.likes || [];
    video.dislikes = video.dislikes || [];
    data.notifications = data.notifications || [];
    video.likes = video.likes.filter(id => id !== userId);
    video.dislikes = video.dislikes.filter(id => id !== userId);
    if (input.type === "like") video.likes.push(userId);
    if (input.type === "dislike") video.dislikes.push(userId);
    if (input.type === "like" && video.ownerId && video.ownerId !== userId) {
      const liker = data.users.find(user => user.id === userId);
      const owner = data.users.find(user => user.id === video.ownerId);
      if (owner) {
        data.notifications.unshift({
          id: store.id("note"),
          userId: owner.id,
          title: "Your video was liked",
          body: `${liker ? liker.name : "Someone"} liked "${video.title}"`,
          read: false,
          createdAt: new Date().toISOString()
        });
      }
    }
    return reactionSummary(data, video);
  });
}

function reactionSummary(data, video) {
  const likedBy = (video.likes || [])
    .map(userId => data.users.find(user => user.id === userId))
    .filter(Boolean)
    .map(user => ({ id: user.id, name: user.name, email: user.email }));
  const dislikedBy = (video.dislikes || [])
    .map(userId => data.users.find(user => user.id === userId))
    .filter(Boolean)
    .map(user => ({ id: user.id, name: user.name, email: user.email }));
  return {
    likes: video.likes.length,
    dislikes: video.dislikes.length,
    likedBy,
    dislikedBy
  };
}

function reactions(store, videoId) {
  const data = store.read();
  const video = data.videos.find(item => item.id === videoId);
  if (!video) fail("Video not found", 404);
  return reactionSummary(data, video);
}

function comments(store, videoId) {
  const data = store.read();
  return data.comments
    .filter(comment => comment.videoId === videoId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function addComment(store, userId, videoId, input) {
  const text = String(input.text || "").trim();
  if (!text) fail("Comment text is required");
  return store.update(data => {
    const user = data.users.find(item => item.id === userId);
    const comment = {
      id: store.id("com"),
      videoId,
      userId,
      author: user ? user.name : "Viewer",
      text,
      parentId: input.parentId || null,
      createdAt: new Date().toISOString()
    };
    data.comments.push(comment);
    return comment;
  });
}

function toggleSubscription(store, userId, channelId) {
  return store.update(data => {
    const user = data.users.find(item => item.id === userId);
    user.subscriptions = user.subscriptions || [];
    const subscribed = user.subscriptions.includes(channelId);
    user.subscriptions = subscribed ? user.subscriptions.filter(id => id !== channelId) : [...user.subscriptions, channelId];
    return { subscribed: !subscribed, subscriptions: user.subscriptions };
  });
}

module.exports = { react, reactions, comments, addComment, toggleSubscription };
