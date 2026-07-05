const crypto = require("crypto");

const secret = process.env.JWT_SECRET || "dev-streamdeck-secret";

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function hash(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function base64Url(input) {
  return Buffer.from(JSON.stringify(input)).toString("base64url");
}

function sign(payload) {
  const header = base64Url({ alg: "HS256", typ: "JWT" });
  const body = base64Url({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token, store) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (signature !== expected) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  const user = store.read().users.find(item => item.id === payload.sub);
  return user ? publicUser(user) : null;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    subscriptions: user.subscriptions || [],
    settings: user.settings || { theme: "dark", downloadPreference: "720p" }
  };
}

function register(store, input) {
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const confirmPassword = String(input.confirmPassword || password);
  if (!name || !email || password.length < 4) fail("Name, email, and a 4+ character password are required");
  if (password !== confirmPassword) fail("Passwords do not match");

  return store.update(data => {
    if (data.users.some(user => user.email === email)) fail("Email is already registered", 409);
    const user = {
      id: store.id("user"),
      name,
      email,
      passwordHash: hash(password),
      subscriptions: [],
      createdAt: new Date().toISOString(),
      settings: { theme: "dark", downloadPreference: "720p" }
    };
    data.users.push(user);
    data.profiles.push({
      id: store.id("profile"),
      userId: user.id,
      name: "Main Profile",
      type: "Adult",
      avatar: "User",
      focus: "All",
      history: [],
      downloads: [],
      preferences: { categories: ["Tech", "Education"] }
    });
    return { user: publicUser(user), token: sign({ sub: user.id }) };
  });
}

function login(store, input) {
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const user = store.read().users.find(item => item.email === email);
  const isDemo = user && user.passwordHash === "demo" && password === "demo1234";
  if (!user || (!isDemo && user.passwordHash !== hash(password))) fail("Invalid email or password", 401);
  return { user: publicUser(user), token: sign({ sub: user.id }) };
}

function updateSettings(store, userId, input) {
  return store.update(data => {
    const user = data.users.find(item => item.id === userId);
    if (!user) fail("User not found", 404);
    user.settings = {
      theme: input.theme || user.settings?.theme || "dark",
      downloadPreference: input.downloadPreference || user.settings?.downloadPreference || "720p"
    };
    return publicUser(user);
  });
}

module.exports = { register, login, verifyToken, updateSettings };
