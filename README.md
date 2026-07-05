# I-TECH Video Stream

A dependency-free full-stack MVP for a YouTube-like video platform with Netflix-style multi-profile support.

## Implemented Phases

- Phase 1: Auth, upload, streaming, home feed, search, responsive UI.
- Phase 2: Threaded comments, likes/dislikes, subscriptions, channel-style metadata.
- Phase 3: Multi-profile selection, profile-specific history and recommendations.
- Phase 4: Smart downloads, profile-specific offline library, local browser offline playback.

## Run

```bash
npm start
```

Open `http://localhost:4173`.

## Architecture

```text
server/
  services/
    authService.js
    profileService.js
    videoService.js
    socialService.js
    recommendationService.js
public/
  index.html
  styles.css
  app.js
data/
  db.json
  videos/
```

The current MVP uses JSON persistence and local file storage. The service modules are intentionally shaped so PostgreSQL and S3-compatible storage can be introduced later behind the same API contracts.
